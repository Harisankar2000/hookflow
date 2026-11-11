import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

// Fast retries so the suite runs in seconds. Set before the app reads config.
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.MAX_ATTEMPTS = '3';
process.env.RETRY_BASE_MS = '40';

import { AppModule } from '../src/app.module';
import { verifySignature } from '../src/common/signature';
import { setupApp } from '../src/setup-app';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('HookFlow (e2e, real Postgres and Redis)', () => {
  let app: NestFastifyApplication;
  let receiver: Server;
  let receiverUrl: string;
  let received: Received[] = [];
  // Decides the status code for the nth request the receiver sees.
  let respond: (requestNumber: number) => number = () => 200;

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(respond(received.length)).end('done');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    setupApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => receiver.close(resolve));
  });

  beforeEach(() => {
    received = [];
    respond = () => 200;
  });

  const call = async (method: 'GET' | 'POST', url: string, apiKey?: string, payload?: object, headers = {}) => {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...headers },
    });
    return { status: response.statusCode, body: response.body ? response.json() : undefined };
  };

  // Each test gets its own tenant so they cannot see each other's data.
  const createTenant = async () => {
    const tenant = await call('POST', '/tenants', undefined, { name: 'Test tenant' }, { 'x-admin-token': 'test-admin-token' });
    expect(tenant.status).toBe(201);
    return tenant.body.apiKey as string;
  };

  const createEndpoint = async (apiKey: string, eventTypes: string[] = []) => {
    const endpoint = await call('POST', '/endpoints', apiKey, { url: receiverUrl, eventTypes });
    expect(endpoint.status).toBe(201);
    return endpoint.body as { id: string; secret: string };
  };

  const waitForStatus = async (apiKey: string, deliveryId: string, status: string) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const delivery = await call('GET', `/deliveries/${deliveryId}`, apiKey);
      if (delivery.body.status === status) {
        return delivery.body;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Delivery ${deliveryId} did not reach ${status}`);
  };

  it('rejects requests without a valid API key', async () => {
    expect((await call('GET', '/endpoints')).status).toBe(401);
    expect((await call('GET', '/endpoints', 'hf_wrong')).status).toBe(401);
  });

  it('retries a failing endpoint with backoff, then delivers a signed payload', async () => {
    const apiKey = await createTenant();
    const endpoint = await createEndpoint(apiKey);
    respond = (requestNumber) => (requestNumber < 3 ? 500 : 200);

    const published = await call('POST', '/events', apiKey, { type: 'order.created', payload: { orderId: 42 } });
    expect(published.status).toBe(201);
    expect(published.body.event.deliveries).toHaveLength(1);

    const delivery = await waitForStatus(apiKey, published.body.event.deliveries[0].id, 'SUCCEEDED');
    expect(delivery.attemptCount).toBe(3);
    expect(delivery.attempts.map((attempt: { statusCode: number }) => attempt.statusCode)).toEqual([500, 500, 200]);

    const last = received[received.length - 1];
    expect(JSON.parse(last.body)).toMatchObject({ type: 'order.created', data: { orderId: 42 } });
    expect(
      verifySignature({
        secret: endpoint.secret,
        timestamp: Number(last.headers['x-hookflow-timestamp']),
        body: last.body,
        signature: String(last.headers['x-hookflow-signature']),
      }),
    ).toBe(true);
  });

  it('stores and delivers an event once when the idempotency key repeats', async () => {
    const apiKey = await createTenant();
    await createEndpoint(apiKey);
    const headers = { 'idempotency-key': 'order-42-created' };
    const event = { type: 'order.created', payload: { orderId: 42 } };

    const first = await call('POST', '/events', apiKey, event, headers);
    const second = await call('POST', '/events', apiKey, event, headers);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.event.id).toBe(first.body.event.id);

    await waitForStatus(apiKey, first.body.event.deliveries[0].id, 'SUCCEEDED');
    expect(received).toHaveLength(1);
    expect((await call('GET', '/events', apiKey)).body).toHaveLength(1);
  });

  it('delivers concurrent duplicates of one idempotency key exactly once', async () => {
    const apiKey = await createTenant();
    await createEndpoint(apiKey);
    const publish = () =>
      call('POST', '/events', apiKey, { type: 'invoice.paid', payload: { invoiceId: 7 } }, { 'idempotency-key': 'invoice-7' });

    const results = await Promise.all(Array.from({ length: 10 }, publish));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(new Set(results.map((result) => result.body.event.id)).size).toBe(1);

    await waitForStatus(apiKey, results[0].body.event.deliveries[0].id, 'SUCCEEDED');
    expect(received).toHaveLength(1);
  });

  it('moves a delivery to the dead letter queue after the last attempt, and replays it', async () => {
    const apiKey = await createTenant();
    await createEndpoint(apiKey);
    respond = () => 503;

    const published = await call('POST', '/events', apiKey, { type: 'order.created', payload: {} });
    const deliveryId = published.body.event.deliveries[0].id;
    const dead = await waitForStatus(apiKey, deliveryId, 'DEAD');
    expect(dead.attemptCount).toBe(3);
    expect(dead.lastError).toBe('HTTP 503');
    expect((await call('GET', '/deliveries?status=DEAD', apiKey)).body).toHaveLength(1);

    respond = () => 200;
    expect((await call('POST', `/deliveries/${deliveryId}/replay`, apiKey)).status).toBe(200);
    const replayed = await waitForStatus(apiKey, deliveryId, 'SUCCEEDED');
    expect(replayed.attemptCount).toBe(4);
  });

  it('only sends an event to endpoints subscribed to its type', async () => {
    const apiKey = await createTenant();
    await createEndpoint(apiKey, ['invoice.paid']);

    const ignored = await call('POST', '/events', apiKey, { type: 'order.created', payload: {} });
    expect(ignored.body.event.deliveries).toHaveLength(0);

    const matched = await call('POST', '/events', apiKey, { type: 'invoice.paid', payload: {} });
    expect(matched.body.event.deliveries).toHaveLength(1);
  });

  it('does not send to a paused endpoint', async () => {
    const apiKey = await createTenant();
    const endpoint = await createEndpoint(apiKey);
    expect((await call('POST', `/endpoints/${endpoint.id}/pause`, apiKey)).body.status).toBe('PAUSED');

    const published = await call('POST', '/events', apiKey, { type: 'order.created', payload: {} });
    expect(published.body.event.deliveries).toHaveLength(0);
  });

  it('reports delivery stats for the tenant', async () => {
    const apiKey = await createTenant();
    await createEndpoint(apiKey);
    const published = await call('POST', '/events', apiKey, { type: 'order.created', payload: {} });
    await waitForStatus(apiKey, published.body.event.deliveries[0].id, 'SUCCEEDED');

    const stats = await call('GET', '/stats', apiKey);
    expect(stats.body).toMatchObject({
      events: 1,
      deliveries: { SUCCEEDED: 1 },
      endpoints: { ACTIVE: 1 },
      last24h: { attempts: 1, successRate: 1 },
    });
  });
});

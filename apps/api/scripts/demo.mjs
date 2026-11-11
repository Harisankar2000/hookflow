// Demo data for the dashboard. Creates an "Acme Commerce" tenant with a set of
// realistic webhook endpoints, runs local receivers that behave like real
// services (healthy, slow, flaky, down), and publishes a stream of events.
//
//   npm run demo            (API must be running; stop with Ctrl+C)
//
// The tenant's API key is written to apps/api/.demo-tenant.json.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const here = new URL('..', import.meta.url);
const env = Object.fromEntries(
  readFileSync(new URL('.env', here), 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);

const API = process.env.API_URL ?? `http://localhost:${env.PORT ?? 3100}`;
const RECEIVER_PORT = Number(process.env.RECEIVER_PORT ?? 4100);
const INITIAL_EVENTS = Number(process.env.INITIAL_EVENTS ?? 60);
const LIVE_INTERVAL_MS = Number(process.env.LIVE_INTERVAL_MS ?? 8000);

// How each simulated service behaves: latency range in ms and how often it fails.
const SERVICES = [
  { path: 'orders', description: 'Orders Service', eventTypes: ['order.created', 'order.shipped', 'order.cancelled'], latency: [20, 60], failRate: 0 },
  { path: 'payments', description: 'Payments Ledger', eventTypes: ['payment.succeeded', 'payment.failed', 'refund.issued'], latency: [80, 160], failRate: 0 },
  { path: 'inventory', description: 'Inventory Sync', eventTypes: ['order.created', 'order.cancelled'], latency: [40, 120], failRate: 0.35, failStatus: 500 },
  { path: 'email', description: 'Email Notifications', eventTypes: ['customer.created', 'order.shipped', 'payment.failed'], latency: [30, 90], failRate: 0 },
  { path: 'analytics', description: 'Analytics Warehouse', eventTypes: [], latency: [400, 900], failRate: 0.1, failStatus: 502 },
  { path: 'fraud', description: 'Fraud Screening', eventTypes: ['payment.succeeded'], latency: [60, 140], failRate: 0.2, failStatus: 429 },
  { path: 'slack', description: 'Slack Alerts', eventTypes: ['payment.failed', 'refund.issued'], latency: [50, 110], failRate: 0 },
  { path: 'crm', description: 'Legacy CRM (down for maintenance)', eventTypes: ['customer.created', 'customer.updated'], latency: [10, 30], failRate: 1, failStatus: 503 },
];

const pick = (items) => items[Math.floor(Math.random() * items.length)];
const between = ([min, max]) => min + Math.random() * (max - min);
const money = () => Math.round(between([499, 24999]));
const NAMES = ['Aarav Mehta', 'Diya Sharma', 'Kabir Nair', 'Ananya Rao', 'Rohan Das', 'Meera Iyer', 'Vikram Patel', 'Sara Khan'];
const CITIES = ['Mumbai', 'Bengaluru', 'Pune', 'Hyderabad', 'Delhi', 'Chennai'];
const SKUS = ['SKU-HEADPHONES-01', 'SKU-KEYBOARD-12', 'SKU-MONITOR-27', 'SKU-CHARGER-65W', 'SKU-BACKPACK-03'];
let orderNumber = 10_000 + Math.floor(Math.random() * 80_000);

// One payload builder per event type, shaped like a real commerce system's events.
const EVENTS = {
  'order.created': () => ({ orderId: `ORD-${++orderNumber}`, customer: pick(NAMES), currency: 'INR', total: money(), items: [{ sku: pick(SKUS), quantity: 1 + Math.floor(Math.random() * 3) }] }),
  'order.shipped': () => ({ orderId: `ORD-${orderNumber}`, carrier: pick(['Delhivery', 'BlueDart', 'Ecom Express']), trackingId: `TRK${Math.floor(between([1e8, 9e8]))}`, city: pick(CITIES) }),
  'order.cancelled': () => ({ orderId: `ORD-${orderNumber}`, reason: pick(['customer_request', 'out_of_stock', 'payment_timeout']) }),
  'payment.succeeded': () => ({ paymentId: `PAY-${randomUUID().slice(0, 8)}`, orderId: `ORD-${orderNumber}`, amount: money(), currency: 'INR', method: pick(['upi', 'card', 'netbanking']) }),
  'payment.failed': () => ({ paymentId: `PAY-${randomUUID().slice(0, 8)}`, orderId: `ORD-${orderNumber}`, amount: money(), currency: 'INR', reason: pick(['insufficient_funds', 'bank_declined', 'otp_timeout']) }),
  'refund.issued': () => ({ refundId: `RFD-${randomUUID().slice(0, 8)}`, orderId: `ORD-${orderNumber}`, amount: money(), currency: 'INR' }),
  'customer.created': () => ({ customerId: `CUS-${randomUUID().slice(0, 8)}`, name: pick(NAMES), city: pick(CITIES) }),
  'customer.updated': () => ({ customerId: `CUS-${randomUUID().slice(0, 8)}`, changed: pick([['phone'], ['address'], ['email', 'phone']]) }),
};
// Orders and payments are the most common events, as in a real store.
const WEIGHTED_TYPES = [
  ...Array(6).fill('order.created'), ...Array(5).fill('payment.succeeded'), ...Array(4).fill('order.shipped'),
  ...Array(2).fill('customer.created'), ...Array(2).fill('payment.failed'), 'order.cancelled', 'refund.issued', 'customer.updated',
];

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

function validSignature(secret, headers, body) {
  const timestamp = Number(headers['x-hookflow-timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`);
  const received = Buffer.from(String(headers['x-hookflow-signature'] ?? ''));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// One HTTP server stands in for all the services; the path picks the behaviour.
function startReceivers(secrets) {
  const byPath = new Map(SERVICES.map((service) => [`/webhooks/${service.path}`, service]));
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const service = byPath.get(req.url);
      if (!service) return res.writeHead(404).end('unknown service');
      setTimeout(() => {
        if (!validSignature(secrets.get(service.path), req.headers, body)) return res.writeHead(401).end('bad signature');
        if (Math.random() < service.failRate) return res.writeHead(service.failStatus).end('service unavailable');
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
      }, between(service.latency));
    });
  });
  return new Promise((resolve) => server.listen(RECEIVER_PORT, () => resolve(server)));
}

async function main() {
  const tenant = await api('/tenants', {
    method: 'POST',
    body: { name: 'Acme Commerce' },
    headers: { 'x-admin-token': env.ADMIN_TOKEN },
  });
  writeFileSync(new URL('.demo-tenant.json', here), JSON.stringify({ ...tenant, apiUrl: API }, null, 2));
  const auth = { authorization: `Bearer ${tenant.apiKey}` };

  const secrets = new Map();
  for (const service of SERVICES) {
    const endpoint = await api('/endpoints', {
      method: 'POST',
      headers: auth,
      body: {
        url: `http://localhost:${RECEIVER_PORT}/webhooks/${service.path}`,
        description: service.description,
        eventTypes: service.eventTypes,
      },
    });
    secrets.set(service.path, endpoint.secret);
  }
  await startReceivers(secrets);
  console.log(`Tenant "Acme Commerce" ready with ${SERVICES.length} endpoints. API key saved to apps/api/.demo-tenant.json`);

  const publish = async () => {
    const type = pick(WEIGHTED_TYPES);
    const result = await api('/events', {
      method: 'POST',
      headers: { ...auth, 'idempotency-key': randomUUID() },
      body: { type, payload: EVENTS[type]() },
    });
    return `${type} -> ${result.event.deliveries.length} deliveries`;
  };

  for (let sent = 0; sent < INITIAL_EVENTS; sent++) {
    await publish();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  console.log(`Published ${INITIAL_EVENTS} events. Sending one more every ${LIVE_INTERVAL_MS / 1000}s; press Ctrl+C to stop.`);

  setInterval(() => publish().then(console.log, (error) => console.error(error.message)), LIVE_INTERVAL_MS);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

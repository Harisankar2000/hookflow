# HookFlow

A webhook management and delivery platform. Applications publish events to HookFlow, and HookFlow delivers them to every subscribed endpoint with signed payloads, retries, a dead letter queue and a full delivery log.

**Stack:** NestJS (Fastify adapter), TypeScript, PostgreSQL, Prisma, Redis, BullMQ, React, Docker.

## Features

- **Multi-tenant API** with hashed API keys. Each tenant sees only its own endpoints, events and deliveries.
- **Endpoint registration** with optional event-type filters, pause/enable and secret rotation.
- **Reliable delivery** on BullMQ: at-least-once, exponential backoff with jitter, configurable attempt limit.
- **Dead letter queue**: deliveries that exhaust their attempts are marked `DEAD` and can be replayed one by one or all at once.
- **HMAC-SHA256 signatures** over `timestamp.body`, with a tolerance window so captured requests cannot be replayed.
- **Idempotent publishing**: an `Idempotency-Key` header stores and delivers an event once, including under concurrent duplicates.
- **Circuit breaker**: an endpoint that fails repeatedly is disabled automatically.
- **Delivery logs and stats**: every attempt records status code, duration and error; `/stats` reports success rate and average response time.
- **React dashboard** to manage endpoints, watch deliveries, inspect attempts, replay and send test events.

## Architecture

```
publisher ──POST /events──▶ API (NestJS + Fastify)
                              │  one transaction: event + one delivery row per matching endpoint
                              ▼
                          PostgreSQL ◀──────────────┐
                              │                     │ attempt log, status updates
                              ▼                     │
                       BullMQ queue (Redis) ──▶ delivery worker ──signed POST──▶ customer endpoint
                                                    │
                                 fail: retry with backoff, then DEAD (dead letter queue)
```

## Run it locally

Requires Node 22 and Docker.

```bash
npm install
npm run infra                       # Postgres on 5434, Redis on 6381
cp apps/api/.env.example apps/api/.env
npm run db:migrate
npm run dev:api                     # http://localhost:3100, Swagger at /docs
npm run dev:web                     # http://localhost:5174
```

To watch retries, run the demo receiver with a failure rate and point an endpoint at `http://localhost:4100/hook`:

```bash
FAIL_RATE=0.5 npm run receiver
```

In the dashboard, open **Settings**, create a tenant with the admin token from `apps/api/.env`, then add an endpoint and send a test event.

## API

All routes except `POST /tenants` need `Authorization: Bearer <api key>`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/tenants` | Create a tenant and get its API key (needs `x-admin-token`) |
| POST, GET | `/endpoints` | Register and list endpoints |
| GET, PATCH, DELETE | `/endpoints/:id` | Read, update, delete an endpoint |
| POST | `/endpoints/:id/pause`, `/enable`, `/rotate-secret` | Endpoint controls |
| POST | `/events` | Publish an event (optional `Idempotency-Key` header) |
| GET | `/events`, `/events/:id` | Recent events and their deliveries |
| GET | `/deliveries`, `/deliveries/:id` | Delivery log, filterable by `status` and `endpointId` |
| POST | `/deliveries/:id/replay`, `/deliveries/replay-dead` | Replay finished or dead deliveries |
| GET | `/stats` | Counts, success rate and average response time |

## Verifying a webhook

Each request carries `x-hookflow-timestamp` and `x-hookflow-signature`. Recompute the signature with the endpoint secret and compare:

```js
const expected = 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
```

Reject the request if the signatures differ or the timestamp is more than five minutes old. `apps/api/scripts/receiver.mjs` is a working example.

## Tests

```bash
npm test
```

The suite runs against real PostgreSQL and Redis (start them with `npm run infra`). It covers API-key auth, retry with backoff, signature verification, idempotency under ten concurrent duplicates, the dead letter queue and replay, event-type filtering, paused endpoints and stats.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAX_ATTEMPTS` | 6 | Attempts before a delivery goes to the dead letter queue |
| `RETRY_BASE_MS` | 5000 | First retry delay; doubles each attempt |
| `RETRY_MAX_MS` | 3600000 | Upper limit for a retry delay |
| `DELIVERY_TIMEOUT_MS` | 10000 | Timeout for one delivery request |
| `CIRCUIT_BREAKER_THRESHOLD` | 20 | Consecutive failures before an endpoint is disabled |

## Roadmap

- Sweeper that re-queues deliveries left `PENDING` if the process stops between the database commit and the queue write.
- Block private and loopback addresses for endpoint URLs in production.
- Per-tenant rate limiting.
- Run the delivery worker as a separate process and add a Dockerfile.

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Delivery, DeliveryStatus, Endpoint, Settings, Stats, loadSettings, request, saveSettings } from './api';

type Tab = 'deliveries' | 'endpoints' | 'send' | 'settings';

const STATUSES: DeliveryStatus[] = ['PENDING', 'RETRYING', 'SUCCEEDED', 'DEAD'];

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [tab, setTab] = useState<Tab>(settings.apiKey ? 'deliveries' : 'settings');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');
  const [openDelivery, setOpenDelivery] = useState<Delivery | null>(null);

  // Runs an action, shows its error if it fails, and reports whether it worked.
  const run = useCallback(async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!settings.apiKey) return;
    await run(async () => {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const [nextStats, nextEndpoints, nextDeliveries] = await Promise.all([
        request<Stats>(settings, '/stats'),
        request<Endpoint[]>(settings, '/endpoints'),
        request<Delivery[]>(settings, `/deliveries${query}`),
      ]);
      setStats(nextStats);
      setEndpoints(nextEndpoints);
      setDeliveries(nextDeliveries);
    });
  }, [settings, statusFilter, run]);

  // Poll so retries show up as they happen.
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = async (action: () => Promise<void>, done: string) => {
    setNotice('');
    if (await run(action)) {
      setNotice(done);
      await refresh();
    }
  };

  const showAttempts = (delivery: Delivery) =>
    run(async () => {
      if (openDelivery?.id === delivery.id) {
        setOpenDelivery(null);
        return;
      }
      setOpenDelivery(await request<Delivery>(settings, `/deliveries/${delivery.id}`));
    });

  const createEndpoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const eventTypes = String(data.get('eventTypes') ?? '')
      .split(',')
      .map((type) => type.trim())
      .filter(Boolean);
    act(async () => {
      await request(settings, '/endpoints', {
        method: 'POST',
        body: { url: data.get('url'), description: data.get('description') || undefined, eventTypes },
      });
      form.reset();
    }, 'Endpoint created');
  };

  const sendEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const key = String(data.get('idempotencyKey') ?? '');
    act(async () => {
      const payload = JSON.parse(String(data.get('payload') || '{}'));
      const result = await request<{ duplicate: boolean }>(settings, '/events', {
        method: 'POST',
        body: { type: data.get('type'), payload },
        headers: key ? { 'idempotency-key': key } : {},
      });
      if (result.duplicate) throw new Error('This idempotency key was already used, so no new event was sent');
    }, 'Event published');
  };

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = { baseUrl: String(data.get('baseUrl')).replace(/\/$/, ''), apiKey: String(data.get('apiKey')).trim() };
    saveSettings(next);
    setSettings(next);
    setNotice('Settings saved');
  };

  const createTenant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    act(async () => {
      const tenant = await request<{ apiKey: string }>({ ...settings, apiKey: '' }, '/tenants', {
        method: 'POST',
        body: { name: data.get('name') },
        headers: { 'x-admin-token': String(data.get('adminToken')) },
      });
      const next = { ...settings, apiKey: tenant.apiKey };
      saveSettings(next);
      setSettings(next);
    }, 'Tenant created and API key saved in this browser');
  };

  const rate = stats?.last24h.successRate;

  return (
    <div className="app">
      <header>
        <h1>HookFlow</h1>
        <nav>
          {(['deliveries', 'endpoints', 'send', 'settings'] as Tab[]).map((name) => (
            <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>
              {name === 'send' ? 'Send event' : name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      {error && <p className="banner error">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}

      {stats && (
        <section className="stats">
          <div><span>Events</span><strong>{stats.events}</strong></div>
          <div><span>Delivered</span><strong>{stats.deliveries.SUCCEEDED ?? 0}</strong></div>
          <div><span>Retrying</span><strong>{(stats.deliveries.RETRYING ?? 0) + (stats.deliveries.PENDING ?? 0)}</strong></div>
          <div><span>Dead letter queue</span><strong>{stats.deliveries.DEAD ?? 0}</strong></div>
          <div><span>Success rate, 24h</span><strong>{rate == null ? 'n/a' : `${(rate * 100).toFixed(1)}%`}</strong></div>
          <div><span>Avg response, 24h</span><strong>{stats.last24h.avgDurationMs == null ? 'n/a' : `${stats.last24h.avgDurationMs} ms`}</strong></div>
        </section>
      )}

      {tab === 'deliveries' && (
        <section>
          <div className="toolbar">
            <label>
              Status{' '}
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeliveryStatus | '')}>
                <option value="">All</option>
                {STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <button
              onClick={() =>
                act(async () => {
                  await request(settings, '/deliveries/replay-dead', { method: 'POST' });
                }, 'Dead deliveries queued for replay')
              }
            >
              Replay all dead
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Event</th><th>Endpoint</th><th>Status</th><th>Attempts</th><th>Last result</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {deliveries.length === 0 && <tr><td colSpan={7} className="empty">No deliveries yet. Create an endpoint, then send an event.</td></tr>}
                {deliveries.map((delivery) => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    detail={openDelivery?.id === delivery.id ? openDelivery : null}
                    onToggle={() => showAttempts(delivery)}
                    onReplay={() =>
                      act(async () => {
                        await request(settings, `/deliveries/${delivery.id}/replay`, { method: 'POST' });
                      }, 'Delivery queued for replay')
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'endpoints' && (
        <section>
          <form className="card" onSubmit={createEndpoint}>
            <h2>Add endpoint</h2>
            <label>URL<input name="url" type="url" required placeholder="http://localhost:4100/hook" /></label>
            <label>Description<input name="description" placeholder="Orders service" /></label>
            <label>Event types, comma separated (empty for all)<input name="eventTypes" placeholder="order.created, invoice.paid" /></label>
            <button type="submit">Create endpoint</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead><tr><th>URL</th><th>Event types</th><th>Status</th><th>Signing secret</th><th></th></tr></thead>
              <tbody>
                {endpoints.length === 0 && <tr><td colSpan={5} className="empty">No endpoints yet.</td></tr>}
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td>{endpoint.url}<small>{endpoint.description}</small></td>
                    <td>{endpoint.eventTypes.length ? endpoint.eventTypes.join(', ') : 'All'}</td>
                    <td><span className={`pill ${endpoint.status}`}>{endpoint.status}</span></td>
                    <td><code>{endpoint.secret}</code></td>
                    <td className="actions">
                      <button
                        onClick={() =>
                          act(async () => {
                            const action = endpoint.status === 'ACTIVE' ? 'pause' : 'enable';
                            await request(settings, `/endpoints/${endpoint.id}/${action}`, { method: 'POST' });
                          }, 'Endpoint updated')
                        }
                      >
                        {endpoint.status === 'ACTIVE' ? 'Pause' : 'Enable'}
                      </button>
                      <button
                        className="danger"
                        onClick={() =>
                          act(async () => {
                            await request(settings, `/endpoints/${endpoint.id}`, { method: 'DELETE' });
                          }, 'Endpoint deleted')
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'send' && (
        <form className="card" onSubmit={sendEvent}>
          <h2>Send a test event</h2>
          <label>Event type<input name="type" required defaultValue="order.created" /></label>
          <label>Payload (JSON)<textarea name="payload" rows={5} defaultValue={'{\n  "orderId": 42\n}'} /></label>
          <label>Idempotency key (optional)<input name="idempotencyKey" placeholder="order-42-created" /></label>
          <button type="submit">Publish event</button>
        </form>
      )}

      {tab === 'settings' && (
        <section className="grid">
          <form className="card" onSubmit={saveKey}>
            <h2>Connection</h2>
            <label>API URL<input name="baseUrl" required defaultValue={settings.baseUrl} /></label>
            <label>API key<input name="apiKey" required defaultValue={settings.apiKey} placeholder="hf_..." /></label>
            <button type="submit">Save</button>
          </form>
          <form className="card" onSubmit={createTenant}>
            <h2>New tenant</h2>
            <label>Tenant name<input name="name" required placeholder="Acme" /></label>
            <label>Admin token<input name="adminToken" type="password" required /></label>
            <button type="submit">Create tenant</button>
          </form>
        </section>
      )}
    </div>
  );
}

function DeliveryRow(props: { delivery: Delivery; detail: Delivery | null; onToggle: () => void; onReplay: () => void }) {
  const { delivery, detail, onToggle, onReplay } = props;
  const finished = delivery.status === 'DEAD' || delivery.status === 'SUCCEEDED';
  return (
    <>
      <tr>
        <td>{delivery.event.type}</td>
        <td>{delivery.endpoint.url}</td>
        <td><span className={`pill ${delivery.status}`}>{delivery.status}</span></td>
        <td>{delivery.attemptCount}</td>
        <td>{delivery.lastError ?? delivery.lastStatusCode ?? ''}</td>
        <td>{new Date(delivery.createdAt).toLocaleString()}</td>
        <td className="actions">
          <button onClick={onToggle}>{detail ? 'Hide' : 'Attempts'}</button>
          {finished && <button onClick={onReplay}>Replay</button>}
        </td>
      </tr>
      {detail && (
        <tr className="detail">
          <td colSpan={7}>
            {detail.attempts?.length ? (
              <ol>
                {detail.attempts.map((attempt) => (
                  <li key={attempt.id}>
                    {new Date(attempt.createdAt).toLocaleTimeString()} · {attempt.statusCode ?? 'no response'} · {attempt.durationMs} ms
                    {attempt.error ? ` · ${attempt.error}` : ''}
                  </li>
                ))}
              </ol>
            ) : (
              'No attempts yet.'
            )}
          </td>
        </tr>
      )}
    </>
  );
}

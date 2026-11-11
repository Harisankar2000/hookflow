export interface Settings {
  baseUrl: string;
  apiKey: string;
}

export interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  secret: string;
  eventTypes: string[];
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  consecutiveFailures: number;
}

export type DeliveryStatus = 'PENDING' | 'RETRYING' | 'SUCCEEDED' | 'DEAD';

export interface Attempt {
  id: string;
  attemptNumber: number;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export interface Delivery {
  id: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  event: { id: string; type: string };
  endpoint: { id: string; url: string };
  attempts?: Attempt[];
}

export interface Stats {
  events: number;
  deliveries: Partial<Record<DeliveryStatus, number>>;
  endpoints: Partial<Record<Endpoint['status'], number>>;
  last24h: { attempts: number; successRate: number | null; avgDurationMs: number | null };
}

const SETTINGS_KEY = 'hookflow.settings';

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { baseUrl: saved.baseUrl ?? 'http://localhost:3100', apiKey: saved.apiKey ?? '' };
  } catch {
    return { baseUrl: 'http://localhost:3100', apiKey: '' };
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function request<T>(
  settings: Settings,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${settings.baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new Error(message ?? `Request failed with ${response.status}`);
  }
  return data as T;
}

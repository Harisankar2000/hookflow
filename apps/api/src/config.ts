// Read at call time so tests can override values before the app starts.
const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const config = {
  port: () => num('PORT', 3100),
  adminToken: () => process.env.ADMIN_TOKEN ?? '',
  maxAttempts: () => num('MAX_ATTEMPTS', 6),
  retryBaseMs: () => num('RETRY_BASE_MS', 5000),
  retryMaxMs: () => num('RETRY_MAX_MS', 3_600_000),
  deliveryTimeoutMs: () => num('DELIVERY_TIMEOUT_MS', 10_000),
  circuitBreakerThreshold: () => num('CIRCUIT_BREAKER_THRESHOLD', 20),
  redis: () => {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
    };
  },
};

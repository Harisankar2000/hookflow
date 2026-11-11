import { config } from '../config';

// Exponential backoff: base, 2x base, 4x base ... capped at the maximum.
export function backoffDelay(attemptsMade: number, jitter = true): number {
  const exponential = Math.min(config.retryBaseMs() * 2 ** Math.max(attemptsMade - 1, 0), config.retryMaxMs());
  // Up to 20% jitter either way so retries to one endpoint do not arrive in a burst.
  return Math.round(jitter ? exponential * (0.8 + Math.random() * 0.4) : exponential);
}

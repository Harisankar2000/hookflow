import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-hookflow-signature';
export const TIMESTAMP_HEADER = 'x-hookflow-timestamp';

// The signed content is "<unix seconds>.<raw body>", so a captured request
// cannot be replayed later with a fresh timestamp.
export function sign(secret: string, timestamp: number, body: string): string {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export interface VerifyInput {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  toleranceSeconds?: number;
  now?: number;
}

// Receivers use this to check that a webhook really came from HookFlow.
export function verifySignature(input: VerifyInput): boolean {
  const { secret, timestamp, body, signature, toleranceSeconds = 300, now = Date.now() } = input;
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > toleranceSeconds) {
    return false;
  }
  const expected = Buffer.from(sign(secret, timestamp, body));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

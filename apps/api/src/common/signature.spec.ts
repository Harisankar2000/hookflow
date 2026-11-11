import { sign, verifySignature } from './signature';

describe('signature', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'order.created' });
  const timestamp = 1_800_000_000;
  const now = timestamp * 1000;

  it('accepts a signature produced with the same secret', () => {
    const signature = sign(secret, timestamp, body);
    expect(verifySignature({ secret, timestamp, body, signature, now })).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = sign(secret, timestamp, body);
    expect(verifySignature({ secret, timestamp, body: body + ' ', signature, now })).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const signature = sign('whsec_other', timestamp, body);
    expect(verifySignature({ secret, timestamp, body, signature, now })).toBe(false);
  });

  it('rejects a timestamp outside the tolerance window', () => {
    const signature = sign(secret, timestamp, body);
    expect(verifySignature({ secret, timestamp, body, signature, now: now + 301_000 })).toBe(false);
  });
});

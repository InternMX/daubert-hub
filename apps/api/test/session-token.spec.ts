import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken } from '../src/security/session-token';

describe('generateSessionToken', () => {
  it('produces a base64url-encoded 256-bit (32-byte) token', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });

  it('produces different tokens on successive calls', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSessionToken()));
    expect(tokens.size).toBe(20);
  });
});

describe('hashSessionToken', () => {
  it('is deterministic for the same input', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('produces a 64-character lowercase hex SHA-256 digest', () => {
    const hash = hashSessionToken('fixed-example-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never equals the raw token it was derived from', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('token-a')).not.toBe(hashSessionToken('token-b'));
  });
});

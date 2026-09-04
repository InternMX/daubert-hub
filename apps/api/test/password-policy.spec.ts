import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, PasswordPolicyError } from '../src/security/password-policy';

describe('assertPasswordPolicy', () => {
  it('accepts a password of exactly 12 characters', () => {
    expect(() => assertPasswordPolicy('123456789012')).not.toThrow();
  });

  it('rejects a password shorter than 12 characters', () => {
    expect(() => assertPasswordPolicy('12345678901')).toThrow(PasswordPolicyError);
  });

  it('rejects a whitespace-only password', () => {
    expect(() => assertPasswordPolicy('            ')).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy('')).toThrow(PasswordPolicyError);
  });

  it('does not silently trim: leading/trailing whitespace counts toward length and content', () => {
    const core = 'x'.repeat(10); // 10 raw characters on its own: below the 12-character minimum.
    const padded = ` ${core} `; // 12 raw characters once padding is included.
    expect(() => assertPasswordPolicy(core)).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy(padded)).not.toThrow();
    expect(padded.trim()).toBe(core); // trimming would have made them equal — policy must not do that.
  });

  it('does not require uppercase, digits, or symbols', () => {
    expect(() => assertPasswordPolicy('lowercaseonlypassword')).not.toThrow();
  });
});

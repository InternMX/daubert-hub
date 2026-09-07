import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTemporaryPassword, TEMPORARY_PASSWORD_ALPHABET } from './generateTemporaryPassword';

const MIN_PASSWORD_LENGTH = 12;

afterEach(() => vi.restoreAllMocks());

describe('generateTemporaryPassword', () => {
  it('produces a 16-character value by default', () => {
    expect(generateTemporaryPassword()).toHaveLength(16);
  });

  it('satisfies the existing minimum password length policy', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it('only ever uses characters from the declared alphabet', () => {
    const password = generateTemporaryPassword();
    expect([...password].every((char) => TEMPORARY_PASSWORD_ALPHABET.includes(char))).toBe(true);
  });

  it('avoids visually ambiguous characters (0/O, 1/l/I)', () => {
    expect(TEMPORARY_PASSWORD_ALPHABET).not.toMatch(/[0O1lI]/);
  });

  it('produces different values across calls (not a fixed string)', () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBeGreaterThan(1);
  });

  it('uses crypto.getRandomValues (Web Crypto), never Math.random', () => {
    const getRandomValues = vi.spyOn(crypto, 'getRandomValues');
    const randomSpy = vi.spyOn(Math, 'random');

    generateTemporaryPassword();

    expect(getRandomValues).toHaveBeenCalled();
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('supports a custom length', () => {
    expect(generateTemporaryPassword(24)).toHaveLength(24);
  });
});

import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/security/password.service';

describe('PasswordService', () => {
  it('produces an Argon2id hash that is never equal to the plaintext', async () => {
    const service = new PasswordService();
    const hash = await service.hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('hashes the same plaintext twice into two different hashes (random salt)', async () => {
    const service = new PasswordService();
    const [first, second] = await Promise.all([
      service.hashPassword('same plaintext password'),
      service.hashPassword('same plaintext password')
    ]);
    expect(first).not.toBe(second);
  });

  it('both independently generated hashes verify successfully against the original plaintext', async () => {
    const service = new PasswordService();
    const [first, second] = await Promise.all([
      service.hashPassword('same plaintext password'),
      service.hashPassword('same plaintext password')
    ]);
    await expect(service.verifyPassword(first, 'same plaintext password')).resolves.toBe(true);
    await expect(service.verifyPassword(second, 'same plaintext password')).resolves.toBe(true);
  });

  it('fails verification for the wrong password', async () => {
    const service = new PasswordService();
    const hash = await service.hashPassword('the real password 123');
    await expect(service.verifyPassword(hash, 'not the real password')).resolves.toBe(false);
  });

  it('fails verification safely (returns false, does not throw) for a malformed hash', async () => {
    const service = new PasswordService();
    await expect(service.verifyPassword('not-a-real-argon2-hash', 'anything')).resolves.toBe(false);
    await expect(service.verifyPassword('', 'anything')).resolves.toBe(false);
  });
});

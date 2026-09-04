import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// Explicit, approved V1 parameters for a modest internal business application
// (OWASP's memory-constrained Argon2id baseline). These are intentionally not
// configurable by callers or environment — changing them is a deliberate code
// change, not runtime configuration.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
} as const;

@Injectable()
export class PasswordService {
  // Relies on argon2's own cryptographically secure random salt generation;
  // the salt is embedded in the returned PHC-format hash string, so no
  // separate salt column is ever needed.
  async hashPassword(plainPassword: string): Promise<string> {
    try {
      return await argon2.hash(plainPassword, ARGON2_OPTIONS);
    } catch {
      // Never let a library error message (which could echo internal state)
      // reach a caller-facing exception.
      throw new Error('No fue posible generar el hash de la contraseña.');
    }
  }

  // A malformed or foreign-format hash must fail verification safely rather
  // than throwing, so callers can always treat a false result as "no match".
  async verifyPassword(passwordHash: string, candidatePassword: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, candidatePassword);
    } catch {
      return false;
    }
  }
}

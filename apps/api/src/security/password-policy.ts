export const MIN_PASSWORD_LENGTH = 12;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Length is evaluated on the raw password, never trimmed — " password " and
// "password" are distinct passwords with distinct lengths. trim() is used
// only to detect a whitespace-only (effectively blank) password.
export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.trim().length === 0) {
    throw new PasswordPolicyError('La contraseña no puede estar vacía.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
}

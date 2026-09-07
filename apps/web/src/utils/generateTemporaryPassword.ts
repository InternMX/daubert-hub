const DEFAULT_LENGTH = 16;

// Deliberately excludes visually ambiguous characters (0/O, 1/l/I, o) — still
// a reasonable alphabet spanning upper/lowercase letters, digits, and a small
// safe symbol set.
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';

export const TEMPORARY_PASSWORD_ALPHABET = `${UPPERCASE}${LOWERCASE}${DIGITS}${SYMBOLS}`;

// Rejection sampling: only accepts values below the largest multiple of
// alphabetLength that fits in a Uint32, so every character in the alphabet
// remains equally likely — a plain `value % alphabetLength` would bias
// toward the low end of the alphabet whenever alphabetLength doesn't evenly
// divide 2^32.
function randomIndex(alphabetLength: number): number {
  const maxValid = Math.floor(0x100000000 / alphabetLength) * alphabetLength;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= maxValid);
  return value % alphabetLength;
}

// Uses the browser/runtime Web Crypto API exclusively (crypto.getRandomValues)
// — never Math.random, which is not cryptographically secure. The result
// still passes through the existing backend password policy (>=12 characters)
// unchanged: this only makes it easy to produce a strong value, it never
// replaces or bypasses that policy.
export function generateTemporaryPassword(length: number = DEFAULT_LENGTH): string {
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += TEMPORARY_PASSWORD_ALPHABET[randomIndex(TEMPORARY_PASSWORD_ALPHABET.length)];
  }
  return password;
}

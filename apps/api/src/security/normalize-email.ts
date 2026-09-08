// Matches security.users' uq_users_email index (lower(btrim(email))) and
// UsersRepository.findByEmail — the same normalization must be used
// wherever a normalized email is used as a lookup/bookkeeping key, so
// case/whitespace variants of the same address are always treated as one.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

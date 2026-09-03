// Pure decision logic for the development-time live database guard. Kept separate from
// DatabaseService/HealthService so reusable, production-safe code never carries this
// dev-only concern — it only runs when the safe dev launcher supplies EXPECTED_DATABASE_NAME.
// The message intentionally carries only database names, never a connection string or
// credentials.
export function assertLiveDatabaseMatches(actual: string | null | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Refusing to start: expected database "${expected}" but the live connection reports "${actual ?? '(unknown)'}".`);
  }
}

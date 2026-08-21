export function assertTestDatabaseUrl(connectionString: string | undefined): string {
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL must be set for database integration tests.');
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(connectionString).pathname).replace(/^\//, '');
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (databaseName !== 'daubert_hub_test') {
    throw new Error(`Refusing database integration tests against "${databaseName || '(missing)'}". Expected "daubert_hub_test".`);
  }
  return connectionString;
}

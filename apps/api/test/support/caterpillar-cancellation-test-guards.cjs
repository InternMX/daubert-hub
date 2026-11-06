// Pure guards: importing this module never opens a connection or reads credentials/files.
function assert(condition, message) { if (!condition) throw new Error(message); }
function guardedUrl(value, user) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Explicit TEST PostgreSQL URL required'); }
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && !url.search && !url.hash,
    'TEST URL must use PostgreSQL with no query overrides');
  assert(decodeURIComponent(url.pathname) === '/daubert_hub_test', 'Only daubert_hub_test is allowed');
  assert(decodeURIComponent(url.username) === user, 'Unexpected TEST database role');
  return url;
}
function markerFor(runId) {
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(runId || ''), 'Explicit canonical run UUID required');
  return `HUB_CAT_CANCEL_E2E_${runId.replace(/-/g, '').toUpperCase()}`;
}
function authorize(action, args) {
  assert(['precheck','apply','postcheck','e2e','verify','cleanup'].includes(action), 'Unknown TEST action');
  if (['apply','e2e','cleanup'].includes(action)) assert(args.includes('--allow-test-writes'), 'Explicit --allow-test-writes authorization required');
}
function childEnvironment(env, url, port) {
  const result = {};
  for (const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE']) if (env[key]) result[key]=env[key];
  Object.assign(result, { DB_HOST:url.hostname, DB_PORT:url.port || '5432', DB_NAME:'daubert_hub_test',
    DB_USER:decodeURIComponent(url.username), DB_PASSWORD:decodeURIComponent(url.password), API_PORT:String(port), AUTH_COOKIE_SECURE:'false',
    PAYMENT_FILE_ASSIGNMENTS_TEST_ENABLED:'false' });
  // Explicit empty values also override an optional local .env loaded by Nest.
  for (const key of ['CATERPILLAR_REPROCESS_WEBHOOK_URL','CATERPILLAR_REPROCESS_WEBHOOK_TOKEN',
    'PAYMENT_NOTIFICATIONS_REPROCESS_WEBHOOK_URL','PAYMENT_NOTIFICATIONS_WEBHOOK_TOKEN','N8N_HEALTH_WEBHOOK_URL','N8N_HEALTH_WEBHOOK_TOKEN']) result[key]='';
  return result;
}
module.exports = { assert, guardedUrl, markerFor, authorize, childEnvironment };

// Guard for the TEST-only n8n integration of point assignments. A READY flag alone is never enough: the reprocess webhook the
// dispatcher will call must be the isolated n8n TEST instance (explicit origin), never the shared/production n8n.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);
const PRODUCTION_N8N_PORT = '5678';
const PRODUCTION_WEBHOOK_PATH = '/daubert-hub/notificaciones-pago/reprocesar';

function parse(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function isIsolatedN8nTestTarget(reprocessWebhookUrl: string | null | undefined, testOrigin: string | null | undefined): boolean {
  const webhook = parse(reprocessWebhookUrl);
  const origin = parse(testOrigin);
  if (!webhook || !origin) return false;
  if (webhook.origin !== origin.origin) return false;
  if (!LOOPBACK_HOSTS.has(origin.hostname)) return false;
  if (!origin.port || origin.port === PRODUCTION_N8N_PORT) return false;
  // The isolated workflow must use its own webhook path, different from the production one.
  if (webhook.pathname.includes(PRODUCTION_WEBHOOK_PATH)) return false;
  return true;
}

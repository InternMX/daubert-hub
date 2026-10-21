// Guard for the TEST-only n8n integration of point assignments. A READY flag alone is never enough: the reprocess webhook the
// dispatcher will call must be one of a CLOSED list of TEST targets (exact host, port and path), never the production webhook.
//
// The Hub TEST usually runs inside Docker, where "localhost" is the container itself: the Windows host is reached as
// host.docker.internal. A Hub started as a Windows process reaches the same n8n through 127.0.0.1 / localhost.
interface N8nTestTarget {
  readonly hosts: readonly string[];
  readonly port: string;
  readonly path: string;            // exact pathname, case-sensitive, no trailing slash
}

const HOST_PRESENTATIONS = ['host.docker.internal', '127.0.0.1', 'localhost'] as const;

export const AUTHORIZED_N8N_TEST_TARGETS: readonly N8nTestTarget[] = [
  // Shared Windows n8n: the Pagos TEST workflow publishes ONLY this exclusive path (never the production one).
  { hosts: HOST_PRESENTATIONS, port: '5678', path: '/webhook/daubert-hub-test/notificaciones-pago/reprocesar' },
  // Temporary isolated Docker n8n. Remove this entry once that instance is retired.
  { hosts: HOST_PRESENTATIONS, port: '5690', path: '/webhook/daubert-hub-test-aislado/notificaciones-pago/reprocesar' }
];

const PRODUCTION_WEBHOOK_PATH = '/daubert-hub/notificaciones-pago/reprocesar';

// PRODUCTION target: the shared Windows n8n that already runs Pagos PROD. Closed list as well (exact host, port and path); the TEST
// paths are never acceptable here and the production path is never acceptable in isIsolatedN8nTestTarget().
export const AUTHORIZED_N8N_PRODUCTION_TARGETS: readonly N8nTestTarget[] = [
  { hosts: HOST_PRESENTATIONS, port: '5678', path: '/webhook' + PRODUCTION_WEBHOOK_PATH }
];

function parse(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isIsolatedN8nTestTarget(reprocessWebhookUrl: string | null | undefined, testOrigin: string | null | undefined): boolean {
  const webhook = parse(reprocessWebhookUrl);
  const origin = parse(testOrigin);
  if (!webhook || !origin) return false;
  // Plain http on the local network only; no credentials, query string or fragment on either URL.
  if (webhook.protocol !== 'http:' || origin.protocol !== 'http:') return false;
  if (webhook.username || webhook.password || webhook.search || webhook.hash) return false;
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return false;
  // The configured TEST origin must be exactly the webhook's origin.
  if (webhook.origin !== origin.origin) return false;
  // The production webhook is never acceptable, whatever the host or port.
  if (webhook.pathname.includes(PRODUCTION_WEBHOOK_PATH)) return false;
  return AUTHORIZED_N8N_TEST_TARGETS.some((target) => target.port === webhook.port && target.hosts.includes(webhook.hostname) && target.path === webhook.pathname);
}

export function isProductionN8nTarget(reprocessWebhookUrl: string | null | undefined, productionOrigin: string | null | undefined): boolean {
  const webhook = parse(reprocessWebhookUrl);
  const origin = parse(productionOrigin);
  if (!webhook || !origin) return false;
  if (webhook.protocol !== 'http:' || origin.protocol !== 'http:') return false;
  if (webhook.username || webhook.password || webhook.search || webhook.hash) return false;
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return false;
  if (webhook.origin !== origin.origin) return false;
  return AUTHORIZED_N8N_PRODUCTION_TARGETS.some((target) => target.port === webhook.port && target.hosts.includes(webhook.hostname) && target.path === webhook.pathname);
}

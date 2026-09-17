import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';

// PN1.2 §1/§2/§9: the ONLY place this API ever talks to n8n. Deliberately thin — it does not
// interpret n8n's response body, does not retry, and never lets an n8n error/URL/body reach the
// caller. Header Auth (a shared secret header) is the confirmed available n8n Webhook Trigger
// authentication mode; the secret lives only in this process's environment and in n8n's own
// Header Auth credential — never in the frontend, never committed (PN1.2 §2/§10).
//
// PN1.2 final scope cleanup: this client used to also support "Ejecutar ahora" (RUN), removed
// because the production n8n workflow already polls independently on its own schedule. Only
// Reprocesar remains. The pattern here — Header Auth via a shared secret header, a bounded
// timeout, and collapsing every failure mode (non-2xx, network error, timeout/abort, DNS/TLS
// failure) into one sanitized outcome — is the template a future automation module's own webhook
// client should follow, not something this class shares directly with other modules.
export type PaymentNotificationsWebhookOutcome = 'ACCEPTED' | 'NOT_CONFIGURED' | 'UPSTREAM_ERROR';

const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_HEADER_NAME = 'X-Daubert-Automation-Token';

@Injectable()
export class PaymentNotificationsWebhookClient {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  // correoId is sent server-to-server only, in the outbound webhook request body — it is never
  // accepted from, or returned to, the browser (PN1.2 §4).
  async triggerReprocess(correoId: string): Promise<PaymentNotificationsWebhookOutcome> {
    const { reprocessWebhookUrl, webhookToken } = this.config.get('paymentNotificationsWebhooks', { infer: true });
    if (!reprocessWebhookUrl || !webhookToken) return 'NOT_CONFIGURED';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(reprocessWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [WEBHOOK_HEADER_NAME]: webhookToken },
        body: JSON.stringify({ correo_id: correoId }),
        signal: controller.signal
      });
      return response.ok ? 'ACCEPTED' : 'UPSTREAM_ERROR';
    } catch {
      // Sanitized by design: network error, timeout/abort, DNS failure, TLS failure, or any other
      // fetch-level failure all collapse to the same outcome. Never expose the underlying error,
      // the webhook URL, or any n8n response body to the caller (PN1.2 §9).
      return 'UPSTREAM_ERROR';
    } finally {
      clearTimeout(timeout);
    }
  }
}

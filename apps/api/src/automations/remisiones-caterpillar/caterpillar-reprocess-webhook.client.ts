import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';

// Phase 12C: the ONLY place this API ever talks to the Caterpillar manual-reprocess n8n webhook.
// Mirrors PaymentNotificationsWebhookClient's template (Header Auth via a shared secret header,
// a bounded timeout, and never letting an n8n error/URL/body reach the caller) with one addition:
// unlike Payment Notifications' webhook (which only ever returns a bare HTTP status), this
// webhook's contract carries a structured JSON body (accepted/status/executionId or
// accepted/error) that n8n itself validates server-side — so this client also validates that
// body's shape before trusting it. Arbitrary/malformed JSON from n8n is never passed through.
export type CaterpillarReprocessAcceptedStatus = 'REPROCESS_CREATED' | 'ALREADY_PROCESSING' | 'ALREADY_REPROCESSED';
export type CaterpillarReprocessRejectionReason = 'NOT_FOUND' | 'NOT_ELIGIBLE_STATE' | 'SOURCE_FILE_MISSING' | 'OUTSIDE_TEST_SCOPE';

export type CaterpillarReprocessWebhookResult =
  | { kind: 'ACCEPTED'; status: CaterpillarReprocessAcceptedStatus; originalExecutionId: string; executionId: string }
  | { kind: 'REJECTED'; reason: CaterpillarReprocessRejectionReason }
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'TIMEOUT' }
  | { kind: 'NETWORK_ERROR' }
  | { kind: 'INVALID_RESPONSE' };

const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_HEADER_NAME = 'X-Daubert-Automation-Token';

const ACCEPTED_STATUSES = new Set<string>(['REPROCESS_CREATED', 'ALREADY_PROCESSING', 'ALREADY_REPROCESSED']);
const KNOWN_REJECTION_REASONS = new Set<string>(['NOT_FOUND', 'NOT_ELIGIBLE_STATE', 'SOURCE_FILE_MISSING', 'OUTSIDE_TEST_SCOPE']);

@Injectable()
export class CaterpillarReprocessWebhookClient {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  // executionId/reason are sent server-to-server only, in the outbound webhook request body — the
  // Hub never sends file paths, document ids, series, plants, or automation codes; n8n/PostgreSQL
  // resolve those from executionId on their own side (Phase 12C.2).
  async triggerReprocess(executionId: string, reason: string): Promise<CaterpillarReprocessWebhookResult> {
    const { url, token } = this.config.get('caterpillarReprocessWebhook', { infer: true });
    if (!url || !token) return { kind: 'NOT_CONFIGURED' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [WEBHOOK_HEADER_NAME]: token },
        body: JSON.stringify({ executionId, reason }),
        signal: controller.signal
      });
    } catch {
      // Sanitized by design: network error, DNS failure, TLS failure, or an aborted (timed-out)
      // request all land here — never expose the underlying error, the webhook URL, or the token
      // to the caller. Distinguish only the one case the Hub API should report differently
      // (timeout vs. any other network-level failure).
      clearTimeout(timeout);
      return controller.signal.aborted ? { kind: 'TIMEOUT' } : { kind: 'NETWORK_ERROR' };
    }
    clearTimeout(timeout);

    // The n8n HTTP status is used only to pick which parser to run — it is NOT itself the domain
    // contract, and this client never requires a specific 2xx code for a given domain status
    // (e.g. it does not require 202 for REPROCESS_CREATED). n8n's actual "accepted" response node
    // returns 200 for every ACCEPTED-kind outcome in practice; requiring exactly 202 here was a
    // real bug (Phase 12C §fix: a genuine REPROCESS_CREATED with a 200 status was misclassified
    // as NETWORK_ERROR -> 502, even though n8n had correctly created the child execution). Any
    // 2xx is accepted as "attempt to parse as an accepted body" — the actual domain validity
    // (accepted === true, a known status, valid ids) is still fully enforced inside
    // parseAccepted() below, never relaxed. 400/404/409/422 are still the only statuses that
    // attempt rejection parsing, matching n8n's actual rejection behavior. Anything else (3xx, an
    // unrecognized 4xx, 5xx from n8n's own sanitized internal-error path, etc.) is treated as an
    // upstream failure, never guessed at as a domain outcome — this is what still lets a
    // structurally incoherent or unrecognized response be told apart from "n8n is broken".
    if (response.status >= 200 && response.status < 300) return this.parseAccepted(response);
    if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 422) return this.parseRejected(response);
    return { kind: 'NETWORK_ERROR' };
  }

  private async parseAccepted(response: Response): Promise<CaterpillarReprocessWebhookResult> {
    const body = await this.readJson(response);
    if (typeof body !== 'object' || body === null) return { kind: 'INVALID_RESPONSE' };
    const payload = body as Record<string, unknown>;
    const { status, originalExecutionId, executionId } = payload;

    if (
      payload.accepted === true &&
      typeof status === 'string' && ACCEPTED_STATUSES.has(status) &&
      typeof originalExecutionId === 'string' && originalExecutionId.length > 0 &&
      typeof executionId === 'string' && executionId.length > 0
    ) {
      return { kind: 'ACCEPTED', status: status as CaterpillarReprocessAcceptedStatus, originalExecutionId, executionId };
    }
    return { kind: 'INVALID_RESPONSE' };
  }

  private async parseRejected(response: Response): Promise<CaterpillarReprocessWebhookResult> {
    const body = await this.readJson(response);
    if (typeof body !== 'object' || body === null) return { kind: 'INVALID_RESPONSE' };
    const payload = body as Record<string, unknown>;
    const { error } = payload;

    if (payload.accepted !== false) return { kind: 'INVALID_RESPONSE' };
    if (typeof error === 'string' && KNOWN_REJECTION_REASONS.has(error)) return { kind: 'REJECTED', reason: error as CaterpillarReprocessRejectionReason };
    // An error code this client does not recognize (e.g. a future n8n rejection it hasn't been
    // taught about yet) is a contract break, not a domain outcome — it must never be surfaced as
    // a REJECTED (which the Hub maps to a 404/409-class response implying "we understood your
    // request and it's not eligible"). Only the four known reasons above are ever REJECTED;
    // anything else is INVALID_RESPONSE, which the Hub maps to 502.
    return { kind: 'INVALID_RESPONSE' };
  }

  // Non-JSON or malformed body from n8n — never surfaced as raw text to the caller.
  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}

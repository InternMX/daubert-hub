import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

// V1 policy — "10 then cooldown-with-probes":
//   1. The first LOGIN_RATE_LIMIT_MAX_FAILURES (10) failures for a normalized
//      email within a 15-minute window are permitted through to a real
//      credential check (Argon2 verification), each getting the normal
//      generic 401.
//   2. The moment the 10th failure lands, cooldown begins: from then on,
//      only one credential-verification "probe" is allowed through per
//      LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS (60s). Every other attempt in that
//      window is rejected with 429 *before* any Argon2 work — a bare Map
//      lookup, not a password hash.
//   3. A probe is granted regardless of what the caller will submit — it's
//      simply "the next attempt after enough time has passed may verify
//      credentials". If that attempt's password is correct, AuthService
//      calls recordSuccess() and the counter is wiped entirely. If it's
//      wrong, cooldown continues and the next probe opens one interval
//      later.
//
// Why this exists (do not remove this rationale — it is the whole point of
// the design): a naive "block everything once over threshold for the rest
// of the window" policy — which is what V1 originally shipped — makes the
// login endpoint an attacker-triggered denial-of-service against a *known,
// legitimate* email: 10 wrong guesses and the real account holder's correct
// password can no longer even be checked for the rest of the window, and an
// attacker can repeat this indefinitely by re-triggering it every window.
// Full lockout is out of scope for V1 (no CAPTCHA, no DB account lock), but
// leaving that DoS window fully open is not acceptable either. This probe
// design keeps the two goals in balance: attacker-triggered Argon2 work is
// capped at 1 verification per minute per targeted email (down from
// unlimited), while the legitimate owner of that email is guaranteed a
// credential-verification opportunity at least once a minute, indefinitely,
// without any CAPTCHA/IP/account-lock mechanism.
//
// Residual limitation (documented, not solved here — see the Phase 8A
// report): the probe is a single shared opportunity, not tied to a caller
// identity we can trust (no reliable client IP behind the temporary
// Cloudflare Quick Tunnel — see the IP/proxy decision in the Phase 8A
// report). An attacker who automates a request at the exact moment each
// probe opens can keep "stealing" it from the legitimate user, extending
// their lockout indefinitely even though Argon2 usage stays capped. Solving
// that would require a trusted per-caller signal (a real client IP, or a
// stronger V2 mechanism) that this deployment does not yet have.
export const LOGIN_RATE_LIMIT_MAX_FAILURES = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS = 60 * 1000;

export const LOGIN_RATE_LIMITED_MESSAGE = 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.';
export const LOGIN_RATE_LIMITED_CODE = 'LOGIN_RATE_LIMITED';

interface FailureWindow {
  count: number;
  windowStartedAt: number;
  // Timestamp of the last credential-verification opportunity granted while
  // in cooldown (count >= MAX_FAILURES). Initialized alongside the window,
  // then re-armed to "now" the instant the threshold is first crossed (see
  // recordFailure) — so slowly-paced failures spread across many minutes
  // never grant an instant "free" probe purely because time has passed
  // since the very first failure; the cooldown clock starts exactly when
  // cooldown actually begins. Advanced again each time assertNotBlocked
  // grants a probe.
  lastProbeAt: number;
}

// In-memory only — deliberate for V1 (single local API instance, no
// horizontal scaling; see compose.pilot.yaml). Two consequences to keep in
// mind:
//   - Restarting the API process clears all counters (a fresh deploy or
//     `docker compose restart api` resets everyone to zero failures, and
//     forgets any in-progress cooldown).
//   - If this API is ever run as more than one instance (horizontal
//     scaling), each instance would keep its own counters — counting would
//     no longer be accurate across instances. That would require moving
//     this state to a shared store (e.g. Redis), which is explicitly out of
//     scope for this phase.
// Bookkeeping is keyed by normalized email only — no password material, no
// IP, nothing else is ever stored here, and nothing here is logged.
@Injectable()
export class LoginRateLimiterService {
  private readonly failuresByEmail = new Map<string, FailureWindow>();

  // Called before any credential check. Returns silently when the caller may
  // proceed to verify credentials — either because the threshold hasn't been
  // reached yet, or because this attempt is the periodic cooldown probe.
  // Throws a 429 (with a Retry-After hint, in seconds, on the exception
  // payload) otherwise. Must not reveal whether the account exists: the
  // decision, the message, and the Retry-After value are all identical
  // regardless of whether normalizedEmail corresponds to a real user, an
  // inactive user, or nothing at all — this is checked before any lookup.
  assertNotBlocked(normalizedEmail: string): void {
    const window = this.currentWindow(normalizedEmail);
    if (!window || window.count < LOGIN_RATE_LIMIT_MAX_FAILURES) return;

    const now = Date.now();
    const elapsedSinceLastProbe = now - window.lastProbeAt;
    if (elapsedSinceLastProbe >= LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS) {
      // Grant exactly this one probe, then immediately re-arm the cooldown
      // for the next interval — consumed whether the caller's password
      // turns out right or wrong, so a rapid-fire attacker still only gets
      // one Argon2 check per interval no matter how many requests they send.
      window.lastProbeAt = now;
      return;
    }

    const retryAfterSeconds = Math.ceil((LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS - elapsedSinceLastProbe) / 1000);
    throw new HttpException({ code: LOGIN_RATE_LIMITED_CODE, message: LOGIN_RATE_LIMITED_MESSAGE, retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }

  recordFailure(normalizedEmail: string): void {
    const window = this.currentWindow(normalizedEmail);
    if (window) {
      window.count += 1;
      // The exact instant cooldown begins: arm the probe clock here, not at
      // the first failure, so pacing failures slowly can't buy an early probe.
      if (window.count === LOGIN_RATE_LIMIT_MAX_FAILURES) window.lastProbeAt = Date.now();
    } else {
      const now = Date.now();
      this.failuresByEmail.set(normalizedEmail, { count: 1, windowStartedAt: now, lastProbeAt: now });
    }
  }

  recordSuccess(normalizedEmail: string): void {
    this.failuresByEmail.delete(normalizedEmail);
  }

  private currentWindow(normalizedEmail: string): FailureWindow | undefined {
    const window = this.failuresByEmail.get(normalizedEmail);
    if (!window) return undefined;
    if (Date.now() - window.windowStartedAt > LOGIN_RATE_LIMIT_WINDOW_MS) {
      this.failuresByEmail.delete(normalizedEmail);
      return undefined;
    }
    return window;
  }
}

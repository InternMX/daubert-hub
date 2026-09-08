import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOGIN_RATE_LIMIT_MAX_FAILURES,
  LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS,
  LOGIN_RATE_LIMIT_WINDOW_MS,
  LOGIN_RATE_LIMITED_CODE,
  LOGIN_RATE_LIMITED_MESSAGE,
  LoginRateLimiterService
} from '../src/security/login-rate-limiter.service';

function getRateLimitedException(caught: unknown): HttpException {
  expect(caught).toBeInstanceOf(HttpException);
  return caught as HttpException;
}

describe('LoginRateLimiterService', () => {
  let limiter: LoginRateLimiterService;

  beforeEach(() => {
    limiter = new LoginRateLimiterService();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('allows the first LOGIN_RATE_LIMIT_MAX_FAILURES failures through without throwing', () => {
    const email = 'ana@example.test';
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
      expect(() => limiter.assertNotBlocked(email)).not.toThrow();
      limiter.recordFailure(email);
    }
  });

  it('blocks the attempt immediately after the 10th failure (11th attempt) with a 429', () => {
    const email = 'ana@example.test';
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) limiter.recordFailure(email);

    let caught: unknown;
    try {
      limiter.assertNotBlocked(email);
    } catch (error) {
      caught = error;
    }

    const exception = getRateLimitedException(caught);
    expect(exception.getStatus()).toBe(429);
    expect(exception.getResponse()).toMatchObject({ code: LOGIN_RATE_LIMITED_CODE, message: LOGIN_RATE_LIMITED_MESSAGE });
  });

  it('uses the exact restrained Spanish message and a safe application-level code', () => {
    expect(LOGIN_RATE_LIMITED_MESSAGE).toBe('Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.');
    expect(LOGIN_RATE_LIMITED_CODE).toBe('LOGIN_RATE_LIMITED');
  });

  it('a successful login resets the failure counter for that email', () => {
    const email = 'ana@example.test';
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) limiter.recordFailure(email);
    expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);

    limiter.recordSuccess(email);

    expect(() => limiter.assertNotBlocked(email)).not.toThrow();
  });

  it('isolates counters by normalized email — one email being blocked does not affect another', () => {
    const blocked = 'blocked@example.test';
    const other = 'other@example.test';
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) limiter.recordFailure(blocked);

    expect(() => limiter.assertNotBlocked(blocked)).toThrow(HttpException);
    expect(() => limiter.assertNotBlocked(other)).not.toThrow();
  });

  it('resets the whole window after LOGIN_RATE_LIMIT_WINDOW_MS has elapsed since the first failure', () => {
    const email = 'ana@example.test';
    for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) limiter.recordFailure(email);
    expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);

    vi.setSystemTime(new Date(Date.now() + LOGIN_RATE_LIMIT_WINDOW_MS + 1));

    expect(() => limiter.assertNotBlocked(email)).not.toThrow();
  });

  it('never stores or exposes any password material — only counts and timestamps live in bookkeeping', () => {
    const email = 'ana@example.test';
    limiter.recordFailure(email);
    expect(limiter).not.toHaveProperty('password');
    expect(Object.keys(limiter)).toEqual(['failuresByEmail']);
  });

  describe('cooldown probes (bounded recovery + capped attacker Argon2 usage)', () => {
    const email = 'ana@example.test';

    function exhaustToThreshold() {
      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) limiter.recordFailure(email);
    }

    it('blocks a burst of attempts immediately after crossing the threshold — an attacker cannot trigger unrestricted Argon2 work', () => {
      exhaustToThreshold();

      // Simulate an attacker hammering the endpoint immediately after the
      // 10th failure: every one of these must be rejected before any
      // credential check would run.
      let blockedCount = 0;
      for (let i = 0; i < 50; i++) {
        try {
          limiter.assertNotBlocked(email);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          blockedCount++;
        }
      }
      expect(blockedCount).toBe(50);
    });

    it('grants exactly one credential-verification probe per LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS, not more', () => {
      exhaustToThreshold();
      vi.setSystemTime(new Date(Date.now() + LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS));

      // The first attempt at (or after) the interval is a granted probe.
      expect(() => limiter.assertNotBlocked(email)).not.toThrow();
      // Whether that probe was used for a failure or not, an immediate
      // second attempt in the same instant must still be blocked — only one
      // probe per interval, regardless of how many requests arrive.
      limiter.recordFailure(email);
      expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);
    });

    it('a legitimate correct-password attempt eventually gets a bounded verification opportunity, and success fully resets the limiter', () => {
      exhaustToThreshold();
      expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);

      // The legitimate owner waits out one probe interval and retries with
      // the correct password this time.
      vi.setSystemTime(new Date(Date.now() + LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS));
      expect(() => limiter.assertNotBlocked(email)).not.toThrow();
      limiter.recordSuccess(email);

      // Fully recovered: a fresh streak of LOGIN_RATE_LIMIT_MAX_FAILURES
      // failures is permitted again, from zero.
      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
        expect(() => limiter.assertNotBlocked(email)).not.toThrow();
        limiter.recordFailure(email);
      }
      expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);
    });

    it('slowly-paced failures spread across many minutes do not grant an early "free" probe the instant the threshold is crossed', () => {
      // Space failures 70s apart (comfortably more than
      // LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS, but the whole streak still fits
      // inside the 15-minute window) — by the time the 10th lands, far more
      // than one probe interval has passed since the *first* failure, but
      // cooldown must still start fresh exactly at the 10th, not be already
      // "due" for a probe.
      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
        if (i > 0) vi.setSystemTime(new Date(Date.now() + 70_000));
        limiter.recordFailure(email);
      }

      // Checked at the very instant the 10th failure landed — must already
      // be blocked, not treated as "70s+ since something, so let it through".
      expect(() => limiter.assertNotBlocked(email)).toThrow(HttpException);
    });

    it('reports a Retry-After hint (in seconds) that shrinks toward zero as the next probe approaches, and never exceeds the interval', () => {
      exhaustToThreshold();

      let caught: unknown;
      try {
        limiter.assertNotBlocked(email);
      } catch (error) {
        caught = error;
      }
      const first = getRateLimitedException(caught).getResponse() as { retryAfterSeconds: number };
      expect(first.retryAfterSeconds).toBe(LOGIN_RATE_LIMIT_PROBE_INTERVAL_MS / 1000);

      vi.setSystemTime(new Date(Date.now() + 20_000));
      let secondCaught: unknown;
      try {
        limiter.assertNotBlocked(email);
      } catch (error) {
        secondCaught = error;
      }
      const second = getRateLimitedException(secondCaught).getResponse() as { retryAfterSeconds: number };
      expect(second.retryAfterSeconds).toBe(40);
      expect(second.retryAfterSeconds).toBeLessThan(first.retryAfterSeconds);
    });

    it('produces identical blocked-attempt behavior (status, code, message, Retry-After) for an unknown-account key as for a known one', () => {
      const unknownEmail = 'never-registered@example.test';
      const knownEmail = 'known@example.test';
      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX_FAILURES; i++) {
        limiter.recordFailure(unknownEmail);
        limiter.recordFailure(knownEmail);
      }

      let unknownCaught: unknown;
      let knownCaught: unknown;
      try {
        limiter.assertNotBlocked(unknownEmail);
      } catch (error) {
        unknownCaught = error;
      }
      try {
        limiter.assertNotBlocked(knownEmail);
      } catch (error) {
        knownCaught = error;
      }

      const unknownResponse = getRateLimitedException(unknownCaught).getResponse();
      const knownResponse = getRateLimitedException(knownCaught).getResponse();
      expect(unknownResponse).toEqual(knownResponse);
      expect(getRateLimitedException(unknownCaught).getStatus()).toBe(getRateLimitedException(knownCaught).getStatus());
    });
  });
});

// Restart-clears-counters and multi-instance-needs-shared-storage are
// documented, deliberate properties of the in-memory Map used above (see the
// comments on LoginRateLimiterService itself) — not something to simulate in
// a unit test: a real process restart is out of scope here, and the class
// exists precisely because there is exactly one API instance in this V1
// deployment (see compose.pilot.yaml).

import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CSRF_ORIGIN_NOT_ALLOWED_CODE, CSRF_ORIGIN_NOT_ALLOWED_MESSAGE, CsrfOriginGuard } from '../src/security/csrf-origin.guard';

function contextFor(method: string, headers: Record<string, string | string[] | undefined>): ExecutionContext {
  const request = { method, headers };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const SAME_HOST = 'app.example.test';

describe('CsrfOriginGuard', () => {
  const guard = new CsrfOriginGuard();

  describe('safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      it(`always allows ${method}, regardless of headers`, () => {
        const context = contextFor(method, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', host: SAME_HOST });
        expect(guard.canActivate(context)).toBe(true);
      });
    }
  });

  describe('unsafe methods — Origin validation', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      it(`${method}: allows a matching Origin + Host`, () => {
        const context = contextFor(method, { origin: `https://${SAME_HOST}`, host: SAME_HOST });
        expect(guard.canActivate(context)).toBe(true);
      });

      it(`${method}: rejects a mismatching Origin + Host with 403 CSRF_ORIGIN_NOT_ALLOWED`, () => {
        const context = contextFor(method, { origin: 'https://evil.example', host: SAME_HOST });
        let caught: unknown;
        try {
          guard.canActivate(context);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ForbiddenException);
        expect((caught as ForbiddenException).getStatus()).toBe(403);
        expect((caught as ForbiddenException).getResponse()).toEqual({ code: CSRF_ORIGIN_NOT_ALLOWED_CODE, message: CSRF_ORIGIN_NOT_ALLOWED_MESSAGE });
      });
    }

    it('rejects a malformed Origin header', () => {
      const context = contextFor('POST', { origin: 'not-a-valid-origin', host: SAME_HOST });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rejects the literal "null" Origin some browsers send for sandboxed/opaque contexts', () => {
      const context = contextFor('POST', { origin: 'null', host: SAME_HOST });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rejects a different port on an otherwise matching host', () => {
      const context = contextFor('POST', { origin: `https://${SAME_HOST}:8443`, host: SAME_HOST });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows a matching explicit port on both sides', () => {
      const context = contextFor('POST', { origin: `http://${SAME_HOST}:8080`, host: `${SAME_HOST}:8080` });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('ignores scheme differences (http vs https) — Cloudflare terminates TLS before the local hop', () => {
      const context = contextFor('POST', { origin: `http://${SAME_HOST}`, host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('normalizes case safely on both Origin host and request Host', () => {
      const context = contextFor('POST', { origin: `https://${SAME_HOST.toUpperCase()}`, host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects when Origin is present but the Host header is missing entirely (defensive)', () => {
      const context = contextFor('POST', { origin: `https://${SAME_HOST}`, host: undefined });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });
  });

  describe('unsafe methods — Sec-Fetch-Site', () => {
    it('rejects Sec-Fetch-Site: cross-site even with no Origin header at all', () => {
      const context = contextFor('POST', { 'sec-fetch-site': 'cross-site', host: SAME_HOST });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('rejects Sec-Fetch-Site: cross-site even when Origin happens to match Host (Sec-Fetch-Site wins)', () => {
      const context = contextFor('POST', { 'sec-fetch-site': 'cross-site', origin: `https://${SAME_HOST}`, host: SAME_HOST });
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('allows Sec-Fetch-Site: same-origin with a matching Origin', () => {
      const context = contextFor('POST', { 'sec-fetch-site': 'same-origin', origin: `https://${SAME_HOST}`, host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows Sec-Fetch-Site: same-origin with no Origin header at all', () => {
      const context = contextFor('POST', { 'sec-fetch-site': 'same-origin', host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });

    // Deliberately conservative: same-site is broader than same-origin (it
    // covers sibling subdomains too), and this deployment has no need to
    // accept those — same-site is NOT treated as automatically safe on its
    // own, it still falls through to the strict Origin/Host match below.
    it('is conservative about Sec-Fetch-Site: same-site — a matching Origin host is still required', () => {
      const matching = contextFor('POST', { 'sec-fetch-site': 'same-site', origin: `https://${SAME_HOST}`, host: SAME_HOST });
      expect(guard.canActivate(matching)).toBe(true);

      const differentSubdomain = contextFor('POST', { 'sec-fetch-site': 'same-site', origin: 'https://other.example.test', host: SAME_HOST });
      expect(() => guard.canActivate(differentSubdomain)).toThrow(ForbiddenException);
    });

    it('falls back to Origin/non-browser behavior when Sec-Fetch-Site is absent', () => {
      const context = contextFor('POST', { host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('non-browser compatibility', () => {
    it('allows an unsafe request with neither Origin nor Sec-Fetch-Site (integration runners, curl, internal automation)', () => {
      const context = contextFor('POST', { host: SAME_HOST });
      expect(guard.canActivate(context)).toBe(true);
    });

    it('does not require any magic bypass header — absence alone is what allows it', () => {
      const context = contextFor('DELETE', { host: SAME_HOST, 'user-agent': 'curl/8.0' });
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

export const CSRF_ORIGIN_NOT_ALLOWED_CODE = 'CSRF_ORIGIN_NOT_ALLOWED';
export const CSRF_ORIGIN_NOT_ALLOWED_MESSAGE = 'El origen de la solicitud no está permitido.';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Phase 8B — browser Origin/Fetch-Metadata defense-in-depth against CSRF.
// This is NOT a synchronizer-token CSRF system and is NOT cryptographic
// proof of request origin: it is a restrained check of two browser-supplied
// headers (Sec-Fetch-Site, Origin) that a real browser cannot be scripted by
// a third-party site into forging for a cross-site request, combined with
// SameSite=Strict on the session cookie (already in place — see
// session-cookie.ts) as the primary defense. A non-browser client (curl,
// integration test runners, future internal automation) sends neither
// header and is deliberately allowed through — see "missing Origin" below.
//
// Registered as the FIRST global APP_GUARD (see app.module.ts), i.e. before
// AuthGuard, MustChangePasswordGuard, RolesGuard, and before any pipe or
// controller/service code runs. This is deliberate: an obviously cross-site
// browser request is rejected before AuthGuard's session lookup (a
// PostgreSQL round trip), before LoginRateLimiterService bookkeeping, and
// before any Argon2 verification — no expensive work is ever spent on a
// request this guard rejects. It applies uniformly to every unsafe-method
// route, @Public() or not (login/logout/change-password included) — public
// status is about authentication, not about browser-origin trust.
//
// Policy for unsafe methods (POST/PUT/PATCH/DELETE); GET/HEAD/OPTIONS are
// always exempt:
//   1. Sec-Fetch-Site: cross-site  -> reject immediately, regardless of Origin.
//   2. Origin present (and not rejected by #1) -> its host must match the
//      request's own Host header exactly (case-insensitively). Anything
//      else (missing, malformed, mismatched host/port) -> reject.
//   3. Neither header present -> allow (non-browser/API client; see below).
//
// Sec-Fetch-Site: same-site is intentionally NOT special-cased as "allowed
// on its own" — same-site is broader than same-origin (it includes sibling
// subdomains), and this deployment has no operational need to accept
// cross-subdomain requests. A same-site request still has to pass the Origin
// check in step 2, which effectively requires the exact same host, not just
// the same registrable domain.
//
// Origin comparison deliberately ignores scheme: Cloudflare's Quick Tunnel
// terminates TLS before the local HTTP hop reaches Nginx/Express (confirmed
// by inspecting docker/nginx.conf and compose.pilot.yaml — the tunnel always
// talks plain HTTP to the origin container), so the scheme NestJS observes
// on this connection is not authoritative for what the browser actually
// used. Comparing only host:port (both browser-supplied — Origin's host and
// the browser's own Host header — normalized to lowercase) is what the
// current TEST topology can safely support; see the Phase 8B report for why
// this doesn't need a hardcoded tunnel hostname (the request's own Host
// header is the comparison target, not a fixed value).
//
// Only the immediate Host header is trusted — never X-Forwarded-Host or any
// other client-suppliable forwarded header. Nginx forwards the browser's own
// Host verbatim as the literal Host header of the proxied connection (see
// docker/nginx.conf's `proxy_set_header Host $host;`), so `request.headers.host`
// here already reflects the actual public hostname the browser navigated to
// — no `trust proxy` / X-Forwarded-* trust is needed or added.
@Injectable()
export class CsrfOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.has(request.method)) return true;

    if (this.singleHeader(request.headers['sec-fetch-site']) === 'cross-site') this.reject();

    const originHeader = this.singleHeader(request.headers.origin);
    if (originHeader !== undefined && !this.originMatchesRequestHost(originHeader, request)) this.reject();

    return true;
  }

  private originMatchesRequestHost(originHeader: string, request: Request): boolean {
    let origin: URL;
    try {
      origin = new URL(originHeader);
    } catch {
      return false;
    }
    const requestHost = this.singleHeader(request.headers.host);
    if (!requestHost) return false;
    return origin.host.toLowerCase() === requestHost.toLowerCase();
  }

  private singleHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private reject(): never {
    throw new ForbiddenException({ code: CSRF_ORIGIN_NOT_ALLOWED_CODE, message: CSRF_ORIGIN_NOT_ALLOWED_MESSAGE });
  }
}

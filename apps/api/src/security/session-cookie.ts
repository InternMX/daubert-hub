import type { Request, Response } from 'express';
import { SESSION_LIFETIME_MS } from './sessions.service';

// A single, well-known cookie is trivial to read by hand — cookie-parser
// (and its @types package) would be extra dependency surface for no real
// benefit here. Writing uses Express's own built-in res.cookie()/
// res.clearCookie(), already available via @nestjs/platform-express with no
// additional package. Session state itself lives entirely in
// security.sessions; this is not a general session framework.
export const SESSION_COOKIE_NAME = 'daubert_session';

export interface CookieSecurityConfig {
  secure: boolean;
}

// TypeScript interfaces are erased at runtime, so NestJS DI needs an
// explicit token to inject CookieSecurityConfig by — see SecurityModule.
export const COOKIE_SECURITY_CONFIG = Symbol('COOKIE_SECURITY_CONFIG');

function cookieOptions(config: CookieSecurityConfig) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.secure,
    path: '/api'
  };
}

export function setSessionCookie(response: Response, token: string, config: CookieSecurityConfig): void {
  response.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions(config), maxAge: SESSION_LIFETIME_MS });
}

export function clearSessionCookie(response: Response, config: CookieSecurityConfig): void {
  response.clearCookie(SESSION_COOKIE_NAME, cookieOptions(config));
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

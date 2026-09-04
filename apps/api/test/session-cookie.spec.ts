import { describe, expect, it, vi } from 'vitest';
import { clearSessionCookie, readSessionCookie, SESSION_COOKIE_NAME, setSessionCookie } from '../src/security/session-cookie';
import { SESSION_LIFETIME_MS } from '../src/security/sessions.service';

function fakeResponse() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

describe('SESSION_COOKIE_NAME', () => {
  it('is the approved cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('daubert_session');
  });
});

describe('setSessionCookie', () => {
  it('sets HttpOnly, SameSite=Strict, Path=/api, and the 12-hour Max-Age', () => {
    const response = fakeResponse();
    setSessionCookie(response as never, 'raw-token', { secure: false });
    expect(response.cookie).toHaveBeenCalledWith('daubert_session', 'raw-token', {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/api',
      maxAge: SESSION_LIFETIME_MS
    });
  });

  it('uses Secure=false for the TEST/dev configuration', () => {
    const response = fakeResponse();
    setSessionCookie(response as never, 'raw-token', { secure: false });
    expect(response.cookie.mock.calls[0]?.[2]).toMatchObject({ secure: false });
  });

  it('uses Secure=true when explicitly configured for HTTPS production', () => {
    const response = fakeResponse();
    setSessionCookie(response as never, 'raw-token', { secure: true });
    expect(response.cookie.mock.calls[0]?.[2]).toMatchObject({ secure: true });
  });
});

describe('clearSessionCookie', () => {
  it('clears the cookie with matching Path/SameSite/Secure attributes', () => {
    const response = fakeResponse();
    clearSessionCookie(response as never, { secure: true });
    expect(response.clearCookie).toHaveBeenCalledWith('daubert_session', {
      httpOnly: true,
      sameSite: 'strict',
      secure: true,
      path: '/api'
    });
  });
});

describe('readSessionCookie', () => {
  function fakeRequest(cookieHeader: string | undefined) {
    return { headers: { cookie: cookieHeader } };
  }

  it('reads the session cookie among several cookies', () => {
    const request = fakeRequest('other=1; daubert_session=abc123; another=2');
    expect(readSessionCookie(request as never)).toBe('abc123');
  });

  it('returns null when there is no cookie header at all', () => {
    expect(readSessionCookie(fakeRequest(undefined) as never)).toBeNull();
  });

  it('returns null when the session cookie is absent among other cookies', () => {
    expect(readSessionCookie(fakeRequest('other=1; another=2') as never)).toBeNull();
  });

  it('decodes a URL-encoded cookie value', () => {
    const encoded = encodeURIComponent('token/with+special=chars');
    expect(readSessionCookie(fakeRequest(`daubert_session=${encoded}`) as never)).toBe('token/with+special=chars');
  });
});

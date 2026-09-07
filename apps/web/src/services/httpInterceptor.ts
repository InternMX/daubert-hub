import { apiBaseUrl } from './api';
import { notifyPasswordChangeRequired, notifySessionExpired } from './sessionEvents';

// /auth/* responses carry their own meaning (invalid credentials, normal
// unauthenticated hydration, wrong current password) that the auth service
// and its pages already handle directly — the generic interceptor below only
// concerns itself with every OTHER protected API call.
const exemptPrefix = `${apiBaseUrl}/auth/`;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

let installed = false;

// Installs a single global fetch wrapper so a session expiring mid-use (401)
// or a mustChangePassword flip taking effect mid-use (403
// PASSWORD_CHANGE_REQUIRED) is caught for every existing service — none of
// which need to change how they call fetch. Idempotent so it is safe to call
// more than once (e.g. React Strict Mode double-invoking effects).
export function installSessionInterceptor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (requestUrl(input).startsWith(exemptPrefix)) return response;

    if (response.status === 401) {
      notifySessionExpired();
    } else if (response.status === 403) {
      const body: unknown = await response.clone().json().catch(() => null);
      if (typeof body === 'object' && body !== null && 'code' in body && body.code === 'PASSWORD_CHANGE_REQUIRED') {
        notifyPasswordChangeRequired();
      }
    }
    return response;
  };
}

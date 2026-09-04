import { describe, expect, it, vi } from 'vitest';
import { RequestIdMiddleware } from '../src/common/request-id.middleware';

function fakeResponse() {
  return { setHeader: vi.fn() };
}

describe('RequestIdMiddleware', () => {
  it('always generates its own request id, never trusting an incoming X-Request-Id header', () => {
    const middleware = new RequestIdMiddleware();
    const request = { header: () => 'attacker-supplied-correlation-id' } as never;
    const response = fakeResponse();
    const next = vi.fn();

    middleware.use(request, response as never, next);

    expect((request as { requestId: string }).requestId).not.toBe('attacker-supplied-correlation-id');
    expect(response.setHeader).toHaveBeenCalledWith('x-request-id', (request as { requestId: string }).requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('generates a different id on every request, with no dependency on any header at all', () => {
    const middleware = new RequestIdMiddleware();
    const requestA = { header: () => undefined } as never;
    const requestB = { header: () => undefined } as never;
    middleware.use(requestA, fakeResponse() as never, vi.fn());
    middleware.use(requestB, fakeResponse() as never, vi.fn());
    expect((requestA as { requestId: string }).requestId).not.toBe((requestB as { requestId: string }).requestId);
  });
});

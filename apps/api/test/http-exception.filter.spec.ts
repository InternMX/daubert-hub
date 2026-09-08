import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafeExceptionFilter } from '../src/common/http-exception.filter';

function fakeHost() {
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), set: vi.fn() };
  const request = { method: 'POST', url: '/api/auth/login' };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;
  return { host, response };
}

describe('SafeExceptionFilter Retry-After handling', () => {
  it('sets a Retry-After header (seconds) when the exception payload carries retryAfterSeconds', () => {
    const filter = new SafeExceptionFilter();
    const { host, response } = fakeHost();
    const exception = new HttpException({ code: 'LOGIN_RATE_LIMITED', message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.', retryAfterSeconds: 42 }, HttpStatus.TOO_MANY_REQUESTS);

    filter.catch(exception, host);

    expect(response.set).toHaveBeenCalledWith('Retry-After', '42');
    expect(response.status).toHaveBeenCalledWith(429);
  });

  it('never includes retryAfterSeconds in the JSON body — it is header-only', () => {
    const filter = new SafeExceptionFilter();
    const { host, response } = fakeHost();
    const exception = new HttpException({ code: 'LOGIN_RATE_LIMITED', message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.', retryAfterSeconds: 17 }, HttpStatus.TOO_MANY_REQUESTS);

    filter.catch(exception, host);

    const body = response.json.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('retryAfterSeconds');
    expect(body).toEqual({ statusCode: 429, message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.', code: 'LOGIN_RATE_LIMITED' });
  });

  it('does not set Retry-After for ordinary exceptions without a retryAfterSeconds hint', () => {
    const filter = new SafeExceptionFilter();
    const { host, response } = fakeHost();
    const exception = new HttpException({ code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' }, HttpStatus.UNAUTHORIZED);

    filter.catch(exception, host);

    expect(response.set).not.toHaveBeenCalled();
  });

  it('ignores a non-numeric retryAfterSeconds rather than emitting a malformed header', () => {
    const filter = new SafeExceptionFilter();
    const { host, response } = fakeHost();
    const exception = new HttpException({ code: 'X', message: 'x', retryAfterSeconds: 'soon' as unknown as number }, HttpStatus.TOO_MANY_REQUESTS);

    filter.catch(exception, host);

    expect(response.set).not.toHaveBeenCalled();
  });
});

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const httpException = exception instanceof HttpException ? exception : undefined;
    const status = httpException?.getStatus() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const body = status >= 500 ? { statusCode: status, message: 'Error interno del servidor.' } : this.responseFor(httpException!);

    if (status >= 500) {
      this.logger.error(`Unhandled request: ${request.method} ${request.url}`, exception instanceof Error ? exception.stack : undefined);
    }

    const retryAfterSeconds = this.retryAfterFor(httpException);
    if (retryAfterSeconds !== undefined) response.set('Retry-After', String(retryAfterSeconds));

    response.status(status).json(body);
  }

  // Standard Retry-After header (RFC 9110 §10.2.3), in seconds. Read from an
  // opt-in `retryAfterSeconds` field on the exception's response payload
  // (currently only LoginRateLimiterService's 429) — never included in the
  // JSON body itself (see responseFor, which never extracts it), and never
  // varies based on anything that could reveal whether an account exists.
  private retryAfterFor(exception: HttpException | undefined): number | undefined {
    if (!exception) return undefined;
    const payload = exception.getResponse();
    if (typeof payload !== 'object' || payload === null || !('retryAfterSeconds' in payload)) return undefined;
    const value = (payload as { retryAfterSeconds: unknown }).retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private responseFor(exception: HttpException): { statusCode: number; message: string; code?: string; missingRequirements?: string[] } {
    const payload = exception.getResponse();
    if (typeof payload === 'string') return { statusCode: exception.getStatus(), message: payload };
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message = payload.message;
      const code = 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
      // Allow-listed, structured domain detail (e.g. PAYMENT_NOTIFICATIONS_NOT_READY): only an array of
      // upper-case requirement codes ever passes through, never free-form text or internals.
      const requirements = 'missingRequirements' in payload && Array.isArray(payload.missingRequirements)
        && payload.missingRequirements.every((item: unknown) => typeof item === 'string' && /^[A-Z][A-Z0-9_]*$/.test(item))
        ? (payload.missingRequirements as string[])
        : undefined;
      return { statusCode: exception.getStatus(), message: Array.isArray(message) ? 'Solicitud no válida.' : String(message), ...(code ? { code } : {}), ...(requirements ? { missingRequirements: requirements } : {}) };
    }
    return { statusCode: exception.getStatus(), message: 'Solicitud no válida.' };
  }
}

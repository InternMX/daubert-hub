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

    response.status(status).json(body);
  }

  private responseFor(exception: HttpException): { statusCode: number; message: string; code?: string } {
    const payload = exception.getResponse();
    if (typeof payload === 'string') return { statusCode: exception.getStatus(), message: payload };
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const message = payload.message;
      const code = 'code' in payload && typeof payload.code === 'string' ? payload.code : undefined;
      return { statusCode: exception.getStatus(), message: Array.isArray(message) ? 'Solicitud no válida.' : String(message), ...(code ? { code } : {}) };
    }
    return { statusCode: exception.getStatus(), message: 'Solicitud no válida.' };
  }
}

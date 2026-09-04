import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    // Always server-generated: this is the canonical audit-correlation id
    // (app.request_id -> audit.cambios.request_id), so it must never be
    // authoritative from client input — an incoming X-Request-Id used to be
    // accepted verbatim (if it matched a format check), which would have let
    // any caller spoof or collide the value persisted into the audit trail.
    // Nothing currently consumes a distinct "client-supplied" correlation id
    // separately, so this is the smallest safe fix rather than threading an
    // additional, currently-unused field through the request.
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  }
}

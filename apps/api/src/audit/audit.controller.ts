import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../security/route-access.decorators';
import { AuditService, type ListAuditEventsResponse } from './audit.service';
import type { AuditEventDetail } from './audit-presenter';
import { ListAuditEventsDto } from './dto/list-audit-events.dto';

// ADMIN-only: RolesGuard (global, after AuthGuard) enforces this class-level
// @Roles(). A GENERAL user gets 403 ROLE_NOT_ALLOWED; no session gets 401.
@Roles('ADMIN')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  list(@Query() input: ListAuditEventsDto): Promise<ListAuditEventsResponse> {
    return this.audit.list(input);
  }

  @Get('events/:id')
  async detail(@Param('id') id: string): Promise<{ data: AuditEventDetail }> {
    if (!/^[1-9]\d*$/.test(id) || BigInt(id) > 9223372036854775807n) {
      throw new BadRequestException('El identificador del evento debe ser un entero positivo.');
    }
    return { data: await this.audit.get(id) };
  }
}

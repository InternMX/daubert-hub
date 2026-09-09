import { Controller, Get, Query } from '@nestjs/common';
import { ListAudiExecutionsDto } from './dto/list-audi-executions.dto';
import { AudiExecutionsService, type ListAudiExecutionsResponse } from './audi-executions.service';

// Route mirrors the existing frontend page path (/automations/remissions/audi) rather than the
// raw backend code, for the same naming convention already used by automations/payment-notifications.
// No @Roles(...): read-only operational data open to both GENERAL and ADMIN (see RolesGuard).
@Controller('automations/remissions/audi')
export class AudiExecutionsController {
  constructor(private readonly service: AudiExecutionsService) {}

  @Get('executions')
  list(@Query() input: ListAudiExecutionsDto): Promise<ListAudiExecutionsResponse> {
    return this.service.list(input);
  }
}

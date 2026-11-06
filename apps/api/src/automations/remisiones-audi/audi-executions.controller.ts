import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ListAudiExecutionsDto } from './dto/list-audi-executions.dto';
import { AudiExecutionsService, type AudiExecutionDetailResponse, type ListAudiExecutionsResponse } from './audi-executions.service';

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

  @Get('executions/:executionId')
  getExecutionDetail(@Param('executionId') executionId: string): Promise<AudiExecutionDetailResponse> {
    // Same int8 bounds as Caterpillar, without Number()/ParseIntPipe precision loss.
    if (!/^[1-9]\d*$/.test(executionId) || BigInt(executionId) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la ejecución debe ser un entero positivo.');
    }
    return this.service.getDetail(executionId);
  }
}

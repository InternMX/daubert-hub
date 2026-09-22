import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ListCaterpillarExecutionsDto } from './dto/list-caterpillar-executions.dto';
import { CaterpillarExecutionsService, type CaterpillarExecutionDetailResponse, type ListCaterpillarExecutionsResponse } from './caterpillar-executions.service';
import { CaterpillarRoutingService, type ListCaterpillarSeriesResponse } from './caterpillar-routing.service';

// Route prefix mirrors the existing /automations/remissions/audi convention (see
// AudiExecutionsController) rather than the raw backend automation code, matching
// automations/payment-notifications' naming too. No @Roles(...): read-only operational/monitoring
// data open to both GENERAL and ADMIN, same as every other route with no explicit role
// restriction (see RolesGuard). Read-only by design (Phase 12A.3 §E): no POST/PATCH/PUT/DELETE —
// Caterpillar is IN_PREPARATION and this phase implements consultation/monitoring only.
@Controller('automations/remissions/caterpillar')
export class CaterpillarController {
  constructor(
    private readonly routing: CaterpillarRoutingService,
    private readonly executions: CaterpillarExecutionsService
  ) {}

  @Get('series')
  listSeries(): Promise<ListCaterpillarSeriesResponse> {
    return this.routing.listSeries();
  }

  @Get('executions')
  listExecutions(@Query() input: ListCaterpillarExecutionsDto): Promise<ListCaterpillarExecutionsResponse> {
    return this.executions.list(input);
  }

  @Get('executions/:executionId')
  getExecutionDetail(@Param('executionId') executionId: string): Promise<CaterpillarExecutionDetailResponse> {
    this.assertExecutionId(executionId);
    return this.executions.getDetail(executionId);
  }

  // BIGINT-safe: validated as a digit string and range-checked against int8 max, never coerced
  // through Number()/ParseIntPipe (same rule as PaymentNotificationsController.assertExecutionId).
  private assertExecutionId(executionId: string): void {
    if (!/^[1-9]\d*$/.test(executionId) || BigInt(executionId) > 9223372036854775807n) {
      throw new BadRequestException('El identificador de la ejecución debe ser un entero positivo.');
    }
  }
}

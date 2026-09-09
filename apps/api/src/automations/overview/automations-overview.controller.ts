import { Controller, Get } from '@nestjs/common';
import { AutomationsOverviewService } from './automations-overview.service';
import type { AutomationsOverviewResponse } from './automation-overview.types';

// No @Roles(...): read-only operational overview open to both GENERAL and ADMIN, same as every
// other route in this app with no explicit role restriction (see RolesGuard).
@Controller('automations/overview')
export class AutomationsOverviewController {
  constructor(private readonly service: AutomationsOverviewService) {}

  @Get()
  get(): Promise<AutomationsOverviewResponse> {
    return this.service.getOverview();
  }
}

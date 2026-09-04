import { Controller, Get } from '@nestjs/common';
import { Public } from '../security/route-access.decorators';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  getHealth(): Promise<HealthResponse> {
    return this.health.getHealth();
  }
}

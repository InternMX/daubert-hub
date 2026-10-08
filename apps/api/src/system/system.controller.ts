import { Controller, Get } from '@nestjs/common';
import { SystemStatusService, type SystemStatusResponse } from './system-status.service';

// Authenticated by the global AuthGuard (deliberately NOT @Public(), unlike /api/health).
@Controller('system')
export class SystemController {
  constructor(private readonly status: SystemStatusService) {}

  @Get('status')
  getStatus(): Promise<SystemStatusResponse> {
    return this.status.getStatus();
  }
}

import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/authenticated-request';
import { ListRecentActivityDto } from './dto/list-recent-activity.dto';
import { RecentActivityService, type RecentActivityResponse } from './recent-activity.service';

@Controller('recent-activity')
export class RecentActivityController {
  constructor(private readonly recentActivity: RecentActivityService) {}

  @Get()
  list(@Query() input: ListRecentActivityDto, @Req() request?: AuthenticatedRequest): Promise<RecentActivityResponse> {
    // La identidad sale SOLO de la sesión: define qué borradores de manufactura puede ver esta cuenta.
    const user = request?.user;
    return this.recentActivity.list(input, user ? { userId: user.id, role: user.role } : null);
  }
}

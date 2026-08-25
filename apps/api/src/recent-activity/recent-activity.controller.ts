import { Controller, Get, Query } from '@nestjs/common';
import { ListRecentActivityDto } from './dto/list-recent-activity.dto';
import { RecentActivityService, type RecentActivityResponse } from './recent-activity.service';

@Controller('recent-activity')
export class RecentActivityController {
  constructor(private readonly recentActivity: RecentActivityService) {}

  @Get()
  list(@Query() input: ListRecentActivityDto): Promise<RecentActivityResponse> {
    return this.recentActivity.list(input);
  }
}

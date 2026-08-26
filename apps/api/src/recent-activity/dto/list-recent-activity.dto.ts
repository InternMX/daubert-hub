import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum RecentActivityCategoryFilter {
  PROVIDER = 'PROVIDER',
  CONTACT = 'CONTACT',
  AUTOMATION = 'AUTOMATION',
  CLIENT = 'CLIENT'
}

export class ListRecentActivityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 6;

  @IsOptional()
  @IsEnum(RecentActivityCategoryFilter)
  category?: RecentActivityCategoryFilter;
}

import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ListRecentActivityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 6;
}

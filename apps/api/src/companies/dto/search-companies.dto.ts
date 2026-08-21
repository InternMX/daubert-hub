import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchCompaniesDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() || undefined : value)
  search?: string;
}

import { Transform, Type } from 'class-transformer';
import { IsOptional, IsString, IsEnum, IsInt, Max, Min } from 'class-validator';

const trimSearch = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};

export enum ClientSortBy {
  CommercialName = 'commercialName',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc'
}

export class ListClientsDto {
  @IsOptional()
  @Transform(trimSearch)
  @IsString()
  search?: string;

  @IsEnum(SortOrder)
  sortOrder = SortOrder.Asc;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}
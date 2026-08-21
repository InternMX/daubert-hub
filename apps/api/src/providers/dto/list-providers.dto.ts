import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProviderType } from './create-provider.dto';

const trimSearch = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};

export enum ProviderSortBy {
  CommercialName = 'commercialName',
  ProviderType = 'providerType',
  LegalName = 'legalName'
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc'
}

export class ListProvidersDto {
  @IsOptional()
  @Transform(trimSearch)
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProviderType)
  providerType?: ProviderType;

  @IsEnum(ProviderSortBy)
  sortBy = ProviderSortBy.CommercialName;

  @IsEnum(SortOrder)
  sortOrder = SortOrder.Asc;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

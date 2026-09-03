import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { FiscalChangeMode } from '../../providers/dto/update-provider.dto';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const normalizeNotes = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() || null : value;

export class UpdateClientFiscalDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  legalName?: string;

  @Transform(({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsOptional()
  @IsString()
  rfc?: string;

  @IsOptional()
  @IsEnum(FiscalChangeMode)
  changeMode?: FiscalChangeMode;

  @IsOptional()
  @IsDateString()
  effectiveStartDate?: string;
}

export class UpdateClientDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  commercialName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateClientFiscalDto)
  fiscal?: UpdateClientFiscalDto;

  @Transform(normalizeNotes)
  @IsOptional()
  @IsString()
  notes?: string | null;
}

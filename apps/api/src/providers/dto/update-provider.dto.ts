import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ProviderType } from './create-provider.dto';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const normalizeNotes = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() || null : value;
const trimAliases = ({ value }: { value: unknown }): unknown => Array.isArray(value)
  ? value.map((alias) => typeof alias === 'string' ? alias.trim() : alias)
  : value;

export enum FiscalChangeMode {
  Correction = 'CORRECTION',
  NewIdentity = 'NEW_IDENTITY'
}

export class UpdateProviderFiscalDto {
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

export class UpdateProviderDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  commercialName?: string;

  @IsOptional()
  @IsEnum(ProviderType)
  providerType?: ProviderType;

  @IsOptional()
  @Transform(normalizeNotes)
  @IsString()
  notes?: string | null;

  // undefined = unchanged; blank/null = clear the path; otherwise validated by ProvidersService.
  @IsOptional()
  @Transform(normalizeNotes)
  @IsString()
  rutaDropbox?: string | null;

  @IsOptional()
  @Transform(trimAliases)
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @ArrayUnique((alias: unknown) => typeof alias === 'string' ? alias.toLowerCase() : alias)
  aliases?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateProviderFiscalDto)
  fiscal?: UpdateProviderFiscalDto;
}

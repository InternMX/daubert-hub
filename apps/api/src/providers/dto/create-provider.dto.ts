import { Transform, Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';

export enum ProviderType {
  Provider = 'PROVEEDOR',
  Service = 'SERVICIO',
  Freight = 'FLETE'
}

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const normalizeNotes = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim() || null;
};

export class CreateProviderFiscalDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  legalName!: string;

  @Transform(({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @Matches(/^\S+$/, { message: 'rfc must not contain whitespace' })
  @Length(12, 13)
  rfc!: string;
}

export class CreateProviderDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  commercialName!: string;

  @IsEnum(ProviderType)
  providerType!: ProviderType;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProviderFiscalDto)
  fiscal?: CreateProviderFiscalDto | null;

  @IsOptional()
  @Transform(normalizeNotes)
  @IsString()
  notes?: string | null;

  // Relative Dropbox path (core.empresas.ruta_dropbox). Blank => null. Structure/safety is validated
  // and canonicalized by ProvidersService via normalizeDropboxPath (payment-notification-settings/).
  @IsOptional()
  @Transform(normalizeNotes)
  @IsString()
  rutaDropbox?: string | null;
}

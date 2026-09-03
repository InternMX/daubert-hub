import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Length, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const normalizeNotes = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  return value.trim() || null;
};

export class CreateClientFiscalDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  legalName!: string;

  @Transform(({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @Length(12, 13)
  rfc!: string;
}

export class CreateClientDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  commercialName!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateClientFiscalDto)
  fiscal?: CreateClientFiscalDto | null;

  @IsOptional()
  @Transform(normalizeNotes)
  @IsString()
  notes?: string | null;
}
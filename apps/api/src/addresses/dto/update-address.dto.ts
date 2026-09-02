import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { AddressType, optionalAddressText } from './create-address.dto';

export class UpdateAddressDto {
  @IsOptional() @IsEnum(AddressType)
  tipoDireccion?: AddressType;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  calle?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  numeroExterior?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  numeroInterior?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  colonia?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  codigoPostal?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  municipio?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  estado?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  pais?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  direccionCompleta?: string | null;

  @IsOptional() @Transform(optionalAddressText) @IsString()
  referencias?: string | null;

  @IsOptional() @IsBoolean()
  esPrincipal?: boolean;

  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaInicio?: string | null;

  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaFin?: string | null;
}

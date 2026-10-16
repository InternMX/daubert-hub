import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

// Solo campos conocidos y con longitud acotada: el ValidationPipe global (whitelist + forbidNonWhitelisted) rechaza cualquier otra propiedad.
// Los formatos numéricos y de color NO se rechazan aquí: mientras el usuario escribe puede haber valores a medias, y la vista previa los reporta como advertencias.
const short = MaxLength(200);

export class SheetPreviewDataDto {
  @IsOptional() @IsString() @short codigo?: string;
  @IsOptional() @IsString() @MaxLength(500) descripcion?: string;
  @IsOptional() @IsString() @short producto?: string;
  @IsOptional() @IsString() @short cliente?: string;
  @IsOptional() @IsString() @MaxLength(10) fechaEmision?: string;
  @IsOptional() @IsString() @short resinaVci?: string;
  @IsOptional() @IsString() @short colorNombre?: string;
  @IsOptional() @IsString() @MaxLength(16) colorHex?: string;
  @IsOptional() @IsIn(['', 'PMG', 'CP5000', 'NAT']) composicion?: string;
  @IsOptional() @IsIn(['', 'ROLLO', 'PAQUETE']) presentacion?: string;
  @IsOptional() @IsString() @MaxLength(16) cantidad?: string;
  @IsOptional() @IsIn(['', 'BOLSAS', 'HOJAS']) cantidadUnidad?: string;
  @IsOptional() @IsString() @MaxLength(16) ancho?: string;
  @IsOptional() @IsString() @MaxLength(16) largo?: string;
  @IsOptional() @IsIn(['', 'IN', 'MM']) unidadDimensiones?: string;
  @IsOptional() @IsString() @MaxLength(40) calibre?: string;
  @IsOptional() @IsString() @MaxLength(16) pesoLb?: string;
  @IsOptional() @IsString() @MaxLength(500) etiqueta?: string;
  @IsOptional() @IsIn(['', 'DOBLADA', 'EXTENDIDA']) modalidad?: string;
}

export class SheetPreviewRequestDto {
  @IsIn(['BOLSA_PLANA_1', 'HOJA_PAQ']) familia!: 'BOLSA_PLANA_1' | 'HOJA_PAQ';

  @IsDefined() @IsObject() @ValidateNested() @Type(() => SheetPreviewDataDto) datos!: SheetPreviewDataDto;
}


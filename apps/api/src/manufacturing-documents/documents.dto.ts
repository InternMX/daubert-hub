import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { FAMILY_CODES, type FamilyCode } from '../manufacturing-sheets/preview/family-registry';
import { SheetPreviewDataDto } from '../manufacturing-sheets/preview/sheet-preview.dto';

// Estos DTO NO tienen ningún campo de actor (usuario, correo, creado/modificado/finalizado por, fechas, estado, revisión, huella): el ValidationPipe global (whitelist +
// forbidNonWhitelisted) rechaza cualquier propiedad desconocida, de modo que la identidad solo puede venir de la sesión autenticada en el backend.

const ID_ENTERO = /^[1-9]\d{0,17}$/;

export class BindGuardadoDto {
  @IsOptional() @IsString() @MaxLength(64) Code?: string;
  @IsOptional() @IsString() @MaxLength(500) Title?: string;
  @IsOptional() @IsString() @MaxLength(2000) Description?: string;
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1_000_000) Weight?: number;
  @IsOptional() @IsString() @MaxLength(40) CreationDate?: string;
}

export class ColorPersonalizadoDto {
  @IsOptional() @IsString() @MaxLength(200) nombre?: string;
  @IsOptional() @IsString() @MaxLength(16) hex?: string;
}

export class IncidenciaReconocidaDto {
  @IsString() @Matches(/^[A-Za-z0-9_:+.-]{1,160}$/) id!: string;
  @IsString() @MaxLength(2000) huella!: string;
}

/** Identificación del cliente: vinculada a core.empresas (rol CLIENTE) o, solo en TEST, manual sin verificar (queda marcada). */
export class ClienteDocumentoDto {
  @IsOptional() @IsString() @Matches(ID_ENTERO) empresaId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) nombre?: string;
}

export class CreateDraftDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,64}$/) @Matches(/^[^.-]/, { message: 'El código no puede empezar con punto ni guion.' }) codigo!: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/, { message: 'Variante no válida.' }) variante?: string;
  @IsIn(FAMILY_CODES) familia!: FamilyCode;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => SheetPreviewDataDto) datos!: SheetPreviewDataDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => BindGuardadoDto) bind?: BindGuardadoDto;
  @IsOptional() @IsObject() procedencia?: Record<string, unknown>;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ColorPersonalizadoDto) colorPersonalizado?: ColorPersonalizadoDto;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => IncidenciaReconocidaDto) incidenciasReconocidas?: IncidenciaReconocidaDto[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClienteDocumentoDto) cliente?: ClienteDocumentoDto;
}

/** Bloqueo optimista: `version` es la que el usuario vio. Cada sección enviada REEMPLAZA a la guardada; las omitidas se conservan. */
export class UpdateDraftDto {
  @IsInt() @Min(1) @Max(1_000_000) version!: number;
  @IsOptional() @IsIn(FAMILY_CODES) familia?: FamilyCode;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SheetPreviewDataDto) datos?: SheetPreviewDataDto;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => BindGuardadoDto) bind?: BindGuardadoDto;
  @IsOptional() @IsObject() procedencia?: Record<string, unknown>;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ColorPersonalizadoDto) colorPersonalizado?: ColorPersonalizadoDto;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => IncidenciaReconocidaDto) incidenciasReconocidas?: IncidenciaReconocidaDto[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClienteDocumentoDto) cliente?: ClienteDocumentoDto;
  /** Nombre IMPRESO de «Elaboró» (editable). Cambiarlo retira la confirmación salvo que se envíe `elaboroConfirmado: true` en la misma petición. */
  @IsOptional() @IsString() @MaxLength(120) elaboroNombre?: string;
  @IsOptional() @IsBoolean() elaboroConfirmado?: boolean;
  /** Cadena vacía = sin «Autorizó». */
  @IsOptional() @IsString() @MaxLength(120) autorizoNombre?: string;
}

export class VersionDto {
  @IsInt() @Min(1) @Max(1_000_000) version!: number;
}

export class AssignReviewerDto {
  @IsInt() @Min(1) @Max(1_000_000) version!: number;
  /** `null` retira al revisor asignado. */
  @ValidateIf((_objeto, valor) => valor !== null) @IsString() @Matches(ID_ENTERO) revisorUsuarioId!: string | null;
}

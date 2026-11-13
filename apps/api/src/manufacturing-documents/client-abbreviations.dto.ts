import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// Sin campos de actor: la identidad sale de la sesión (el ValidationPipe global rechaza propiedades desconocidas).
const ID_ENTERO = /^[1-9]\d{0,17}$/;
const CODIGO = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/;

export const ALCANCES = ['GENERAL', 'CONTEXTO', 'CODIGO_COMPLETO'] as const;
export type Alcance = (typeof ALCANCES)[number];
export const ACCIONES = ['CONFIRMAR', 'RECHAZAR', 'INACTIVAR', 'REACTIVAR', 'RETIRAR'] as const;
export type Accion = (typeof ACCIONES)[number];
export const ESTADOS_ABREVIATURA = ['CANDIDATA', 'PROPUESTA', 'CONFIRMADA', 'RECHAZADA', 'INACTIVA'] as const;

export class SuggestionsQueryDto {
  @IsString() @Matches(CODIGO) codigo!: string;
}

export class ListAbbreviationsQueryDto {
  @IsOptional() @IsIn([...ESTADOS_ABREVIATURA]) estado?: string;
  @IsOptional() @IsString() @MaxLength(60) q?: string;
  /** Abreviaturas de UN cliente (core.empresas.empresa_id): la ficha del cliente. Una cuenta GENERAL solo puede consultar con este filtro. */
  @IsOptional() @IsString() @Matches(ID_ENTERO) clienteId?: string;
}

export class CreateAbbreviationDto {
  @IsString() @Matches(/^[A-Za-z][A-Za-z0-9]{1,4}$/, { message: 'La abreviatura son de 2 a 5 letras o números y empieza con una letra.' }) abreviatura!: string;
  /** Empresa de core.empresas con rol CLIENTE activo (la base lo valida). */
  @IsString() @Matches(ID_ENTERO) clienteId!: string;
  @IsOptional() @IsIn([...ALCANCES]) alcance?: Alcance;
  /** CONTEXTO: prefijo más largo que empieza con la abreviatura · CODIGO_COMPLETO: el código. */
  @IsOptional() @IsString() @Matches(CODIGO) codigoPatron?: string;
  @IsOptional() @IsString() @MaxLength(1000) evidencia?: string;
  /** ADMIN: registrarla solo como PROPUESTA (por omisión la confirma). Una cuenta GENERAL siempre propone. */
  @IsOptional() @IsBoolean() soloProponer?: boolean;
}

export class ResolveAbbreviationDto {
  @IsIn([...ACCIONES]) accion!: Accion;
  @IsOptional() @IsString() @MaxLength(500) motivo?: string;
}

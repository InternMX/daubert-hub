import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Matches, Max, Min } from 'class-validator';
import { AUDIT_ACTIONS, AUDIT_ENTITY_KEYS, type AuditAction } from '../audit-catalog';

export class ListAuditEventsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  // `from` is inclusive and `to` is exclusive (ISO 8601 instants); the
  // frontend sends local day boundaries so "the whole of day X" is [X, X+1).
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  // audit.cambios.usuario_id is text holding the numeric security.users id.
  @IsOptional()
  @Matches(/^[1-9]\d{0,17}$/)
  userId?: string;

  @IsOptional()
  @IsIn(AUDIT_ENTITY_KEYS)
  entity?: string;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: AuditAction;
}

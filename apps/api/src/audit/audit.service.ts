import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTION_BY_OPERATION, findEntityByTable } from './audit-catalog';
import { buildChanges, presentDetail, presentSummary, type AuditEventDetail, type AuditEventSummary } from './audit-presenter';
import { AuditRepository } from './audit.repository';
import type { ListAuditEventsDto } from './dto/list-audit-events.dto';

export interface ListAuditEventsResponse {
  data: AuditEventSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// This service and its repository never log row contents: datos_anteriores /
// datos_nuevos may hold personal data and are only ever turned into the
// allowlisted field changes returned to the (ADMIN) caller.
@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(input: ListAuditEventsDto): Promise<ListAuditEventsResponse> {
    if (input.from && input.to && new Date(input.from).getTime() >= new Date(input.to).getTime()) {
      throw new BadRequestException('La fecha inicial debe ser anterior a la fecha final.');
    }
    const { rows, total } = await this.repository.list(
      { from: input.from, to: input.to, userId: input.userId, entity: input.entity, action: input.action },
      input.page,
      input.pageSize
    );
    const actorIds = [...new Set(rows.map((row) => row.usuario_id).filter((id): id is string => Boolean(id)))];
    const actorNames = await this.repository.findActorDisplayNames(actorIds);

    const data: AuditEventSummary[] = [];
    for (const row of rows) {
      const entity = findEntityByTable(row.esquema, row.tabla);
      const action = ACTION_BY_OPERATION[row.operacion];
      if (!entity || !action) continue;
      const summary = presentSummary(entity, row, actorNames, buildChanges(entity, action, row.datos_anteriores, row.datos_nuevos));
      if (summary) data.push(summary);
    }
    return { data, meta: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) } };
  }

  async get(id: string): Promise<AuditEventDetail> {
    const row = await this.repository.findById(id);
    const entity = row ? findEntityByTable(row.esquema, row.tabla) : undefined;
    if (!row || !entity) throw new NotFoundException('Evento de auditoría no encontrado.');
    const actorNames = await this.repository.findActorDisplayNames(row.usuario_id ? [row.usuario_id] : []);
    const detail = presentDetail(entity, row, actorNames);
    if (!detail) throw new NotFoundException('Evento de auditoría no encontrado.');
    return detail;
  }
}

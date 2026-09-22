import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditIdentity } from '../common/authenticated-request';
import type { AdjustDocumentSeriesDto } from './dto/adjust-document-series.dto';
import { DocumentSeriesRepository, type DocumentSeriesConfiguration } from './document-series.repository';

export interface AutomationSeriesResponse {
  data: {
    automation: { code: string; name: string; status: string };
    series: { code: string; name: string; nextFolio: number; status: string };
    adjustments: Array<{ previousFolio: number; newFolio: number; reason: string; userEmail: string | null; createdAt: string }>;
  };
}

@Injectable()
export class AutomationsService {
  constructor(private readonly repository: DocumentSeriesRepository) {}

  async getDocumentSeries(automationCode: string, seriesCode: string): Promise<AutomationSeriesResponse> {
    const configuration = await this.repository.findConfiguration(automationCode, seriesCode);
    if (!configuration) throw new NotFoundException('Automatización o serie documental no encontrada.');
    return this.mapResponse(configuration);
  }

  // Phase 12B.2: automationCode/seriesCode ownership is validated inside the repository's own
  // locked query (§D) — a mismatched pair (e.g. REMISIONES_CATERPILLAR + an Audi-only series)
  // surfaces here as the same DOCUMENT_SERIES_NOT_FOUND a genuinely unknown series would, which is
  // deliberate: the caller learns nothing about which series exist for other automations.
  async adjustDocumentSeries(automationCode: string, seriesCode: string, input: AdjustDocumentSeriesDto, requestId: string, identity: AuditIdentity): Promise<AutomationSeriesResponse> {
    try {
      await this.repository.adjustNextFolio(automationCode, seriesCode, input, requestId, identity);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'AUTOMATION_NOT_FOUND' || code === 'DOCUMENT_SERIES_NOT_FOUND') {
        throw new NotFoundException('Automatización o serie documental no encontrada.');
      }
      if (code === 'DOCUMENT_SERIES_FOLIO_UNCHANGED') {
        throw new ConflictException({ code, message: 'El próximo folio debe ser diferente al folio actual.' });
      }
      if (code === 'SERIES_FOLIO_STALE') {
        throw new ConflictException({ code, message: 'El folio actual cambió desde que se cargó esta pantalla. Actualiza la información e intenta de nuevo.' });
      }
      if (code === 'BACKWARD_ACKNOWLEDGEMENT_REQUIRED') {
        throw new BadRequestException({ code, message: 'Debes confirmar que revisaste los archivos de salida antes de mover el folio hacia atrás.' });
      }
      if (code === 'SERIES_FOLIO_FLOOR_UNCONFIGURED') {
        throw new ConflictException({ code, message: 'Esta serie no tiene configurado un límite histórico seguro. No es posible mover el folio hacia atrás todavía.' });
      }
      if (code === 'SERIES_FOLIO_BELOW_FLOOR') {
        throw new ConflictException({ code, message: 'El nuevo folio está por debajo del límite histórico seguro configurado para esta serie.' });
      }
      if (code === 'SERIES_FOLIO_REMISSION_CONFLICT') {
        throw new ConflictException({ code, message: 'Ya existen remisiones generadas dentro del rango de folios que se reutilizarían.' });
      }
      if (code === 'SERIES_FOLIO_RESERVATION_CONFLICT') {
        throw new ConflictException({ code, message: 'Ya existen reservas de folio (activas, aplicadas o abandonadas) dentro del rango que se reutilizaría.' });
      }
      throw error;
    }
    return this.getDocumentSeries(automationCode, seriesCode);
  }

  private mapResponse(configuration: DocumentSeriesConfiguration): AutomationSeriesResponse {
    return {
      data: {
        automation: {
          code: configuration.automation.codigo,
          name: configuration.automation.nombre,
          status: configuration.automation.estatus
        },
        series: {
          code: configuration.series.codigo,
          name: configuration.series.nombre,
          nextFolio: configuration.series.siguiente_folio,
          status: configuration.series.estatus
        },
        adjustments: configuration.adjustments.map((adjustment) => ({
          previousFolio: adjustment.siguiente_folio_anterior,
          newFolio: adjustment.siguiente_folio_nuevo,
          reason: adjustment.motivo,
          userEmail: adjustment.usuario_email,
          createdAt: new Date(adjustment.created_at).toISOString()
        }))
      }
    };
  }
}

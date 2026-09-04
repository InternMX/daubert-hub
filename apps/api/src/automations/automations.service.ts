import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  async adjustDocumentSeries(automationCode: string, seriesCode: string, input: AdjustDocumentSeriesDto, requestId: string, identity: AuditIdentity): Promise<AutomationSeriesResponse> {
    try {
      await this.repository.adjustNextFolio(automationCode, seriesCode, input.nextFolio, input.reason, requestId, identity);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'AUTOMATION_NOT_FOUND' || code === 'DOCUMENT_SERIES_NOT_FOUND') {
        throw new NotFoundException('Automatización o serie documental no encontrada.');
      }
      if (code === 'DOCUMENT_SERIES_FOLIO_UNCHANGED') {
        throw new ConflictException({ code, message: 'El próximo folio debe ser diferente al folio actual.' });
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

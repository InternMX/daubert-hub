import { Injectable } from '@nestjs/common';
import type { InfoFinalizada } from '../manufacturing-sheets/preview/draft-layer';
import type { FamilyCode } from '../manufacturing-sheets/preview/family-registry';
import type { Incidencia } from '../manufacturing-sheets/preview/incidencias';
import type { PreviewFormData } from '../manufacturing-sheets/preview/sheet-data.mapper';
import { SheetPdfService } from '../manufacturing-sheets/preview/sheet-pdf.service';
import { SheetPreviewService } from '../manufacturing-sheets/preview/sheet-preview.service';
import type { BindReviewContext } from '../manufacturing-sheets/preview/technical-coherence';

/** Evaluación de una especificación guardada (misma lógica que la vista previa; el gestor documental no la reimplementa). */
export interface EvaluacionHoja {
  completo: boolean;
  faltantes: string[];
  bloqueado: string | null;
  incidencias: Incidencia[];
}

export interface PdfFinalizado {
  pdf: Buffer;
  filename: string;
}

/**
 * ÚNICO punto de contacto entre la lógica documental y la generación de hojas. El gestor documental depende de este puerto, no de las plantillas, el mapeo de datos ni el renderizador;
 * así ambas lógicas evolucionan por separado y las pruebas del gestor pueden sustituir el motor sin Chrome.
 */
export abstract class SheetEngine {
  /** ¿Se puede producir el PDF final en este entorno? (Chrome es obligatorio para finalizar.) */
  abstract readonly disponible: boolean;
  abstract evaluar(familia: FamilyCode, datos: PreviewFormData, contexto?: BindReviewContext): Promise<EvaluacionHoja>;
  abstract generarFinalizada(familia: FamilyCode, datos: PreviewFormData, contexto: BindReviewContext | undefined, info: InfoFinalizada, variante: string | null): Promise<PdfFinalizado>;
}

@Injectable()
export class SheetEngineAdapter extends SheetEngine {
  constructor(private readonly preview: SheetPreviewService, private readonly pdf: SheetPdfService) {
    super();
  }

  get disponible(): boolean {
    return this.pdf.disponible;
  }

  async evaluar(familia: FamilyCode, datos: PreviewFormData, contexto?: BindReviewContext): Promise<EvaluacionHoja> {
    const r = await this.preview.preview(familia, datos, contexto);
    return { completo: r.completo, faltantes: r.faltantes, bloqueado: r.bloqueado, incidencias: r.incidencias };
  }

  async generarFinalizada(familia: FamilyCode, datos: PreviewFormData, contexto: BindReviewContext | undefined, info: InfoFinalizada, variante: string | null): Promise<PdfFinalizado> {
    const documento = await this.pdf.generarFinalizada(familia, datos, contexto, info, variante);
    return { pdf: documento.pdf, filename: documento.filename };
  }
}

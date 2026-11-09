import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';
import { DatabaseService } from '../../database/database.service';

export interface FolioRecoveryAssessment {
  enabled: boolean;
  databaseEligible: boolean;
  eligible: boolean;
  parentId?: string;
  plant?: string;
  reservationId?: string;
  reservationStatus?: string;
  firstFolio?: string;
  lastFolio?: string;
  codes: string[];
  quarantine?: { state: string; sha256: string | null; fileCount: number };
}

@Injectable()
export class CaterpillarFolioRecoveryService {
  constructor(private readonly db: DatabaseService, private readonly config: ConfigService<EnvironmentConfig, true>) {}

  private enabled(): boolean {
    return this.config.get('caterpillarFolioRecoveryTestEnabled', { infer: true }) === true
      && this.config.get('database', { infer: true }).name === 'daubert_hub_test';
  }

  async assess(parentId: string): Promise<FolioRecoveryAssessment> {
    if (!this.enabled()) return { enabled: false, databaseEligible: false, eligible: false, codes: ['FEATURE_DISABLED'] };
    try {
      const [schema] = await this.db.query<{ installed: boolean }>("SELECT to_regnamespace('cat_recovery_test') IS NOT NULL AS installed");
      if (!schema?.installed) return { enabled: false, databaseEligible: false, eligible: false, codes: ['MIGRATION_NOT_INSTALLED'] };
      const [row] = await this.db.query<{ assessment: FolioRecoveryAssessment }>('SELECT cat_recovery_test.evaluate($1::bigint) AS assessment', [parentId]);
      if (!row) throw new Error('Assessment missing');
      return row.assessment;
    } catch {
      throw new ServiceUnavailableException('No fue posible verificar la recuperación de folios en TEST. La operación permanece bloqueada.');
    }
  }

  // Prepares an auditable request only. It does not claim emission or call the conventional webhook.
  // The trusted coordinator attests files; n8n TEST must later call cat_recovery_test.start through the existing gate.
  async prepare(parentId: string, requestId: string, adminId: string | null, reason: string, confirmedNoDelivery: boolean) {
    if (!this.enabled()) throw new ConflictException('La recuperación de folios está deshabilitada; solo puede prepararse en TEST.');
    if (!adminId) throw new ConflictException('No se pudo determinar el ADMIN solicitante.');
    try {
      const [row] = await this.db.query<{ result: { requestId: string; state: string } }>(
        'SELECT cat_recovery_test.request($1::bigint,$2::uuid,$3::bigint,$4::text,$5::boolean) AS result',
        [parentId, requestId, adminId, reason, confirmedNoDelivery]);
      if (!row) throw new Error('Request missing');
      return row.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('CAT_RECOVERY_DISABLED')) throw new ConflictException('La recuperación permanece deshabilitada en PostgreSQL TEST.');
      if (message.includes('IDEMPOTENCY_CONFLICT')) throw new ConflictException('Esta solicitud ya existe con otros datos. No se creó otra recuperación.');
      if (message.includes('ADMIN_REQUIRED')) throw new ConflictException('La recuperación requiere un ADMIN activo.');
      if (message.includes('CAT_RECOVERY_')) throw new ConflictException('La ejecución ya no cumple las condiciones de recuperación. Actualiza las comprobaciones; no se reservaron folios nuevos.');
      throw new ServiceUnavailableException('No se pudo preparar la recuperación. No se ha solicitado un reproceso convencional.');
    }
  }
}

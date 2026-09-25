import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';

// Invariant: a company with core.empresas_notificacion_pago.notificaciones_activas = true must ALWAYS
// keep at least one operable PARA recipient. Activation already requires it (readiness); this guards the
// contact mutations that could take it away afterwards. es_principal never takes part.
//
// operable PARA = ACTIVE contact + ACTIVE method + tipo_medio 'CORREO' + recibe_notificacion_pago +
// tipo_destinatario_pago 'PARA'.
export const PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA = 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA';

export interface ParaMutationTarget {
  // The single method whose operable-PARA status the mutation removes (edit / deactivate method)...
  methodId?: string | null;
  // ...or the contact whose methods all stop being operable (deactivate contact).
  contactId?: string | null;
}

// Projected-state check, run INSIDE the mutation's own transaction and AFTER the company row is locked
// FOR UPDATE (the same lock PATCH payment-notification-settings takes), so it cannot interleave with a
// concurrent activation or another recipient change. It never writes: the affected method/contact is
// simply excluded from the count of operable PARA recipients, i.e. "what would remain after the change".
// The caller only invokes it for a mutation that removes an operable PARA; if the affected target holds
// none, the current state is unchanged and nothing is blocked (also for legacy rows already without PARA).
export async function assertActiveCompanyKeepsPara(client: PoolClient, companyId: string | number | null | undefined, target: ParaMutationTarget): Promise<void> {
  if (companyId === null || companyId === undefined) return;
  const result = await client.query<{ active: boolean | null; total: number; remaining: number }>(`
    SELECT
      (SELECT settings.notificaciones_activas FROM core.empresas_notificacion_pago settings WHERE settings.empresa_id = $1) AS active,
      count(*)::int AS total,
      count(*) FILTER (WHERE NOT (($2::bigint IS NOT NULL AND method.medio_id = $2::bigint)
                                  OR ($3::bigint IS NOT NULL AND contact.contacto_id = $3::bigint)))::int AS remaining
    FROM core.contactos contact
    JOIN core.medios_contacto method ON method.contacto_id = contact.contacto_id
    WHERE contact.empresa_id = $1
      AND contact.estatus = 'ACTIVO'
      AND method.estatus = 'ACTIVO'
      AND method.tipo_medio = 'CORREO'
      AND method.recibe_notificacion_pago = TRUE
      AND method.tipo_destinatario_pago = 'PARA'`, [companyId, target.methodId ?? null, target.contactId ?? null]);
  const row = result.rows[0];
  if (!row || row.active !== true) return;
  if (row.total > 0 && row.remaining === 0) {
    throw Object.assign(new Error(PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA), { code: PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA });
  }
}

// HTTP mapping shared by the contact and contact-method services: 409 with a stable code and the same
// safe requirement code the settings endpoint uses. No SQL, no ids.
export function activeRequiresParaConflict(): ConflictException {
  return new ConflictException({
    code: PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA,
    message: 'No se puede realizar el cambio porque este es el último destinatario PARA de una empresa con Notificaciones de Pago activas. Agrega otro destinatario PARA o desactiva primero las Notificaciones de Pago.',
    missingRequirements: ['PAYMENT_RECIPIENT_PARA_REQUIRED']
  });
}

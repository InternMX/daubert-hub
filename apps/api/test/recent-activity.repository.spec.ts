import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationActivityRepository } from '../src/recent-activity/payment-notification-activity.repository';
import { RecentActivityRepository } from '../src/recent-activity/recent-activity.repository';

describe('RecentActivityRepository', () => {
  it('queries only Hub audit rows and bounds recent request groups with stable ordering', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RecentActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual({ rows: [], contacts: new Map(), companies: new Map() });

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM audit.cambios change"), [30]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("change.origen = 'DAUBERT_HUB'");
    expect(sql).toContain('change.fecha AS occurred_at');
    expect(sql).toContain('change.request_id IS NOT NULL');
    expect(sql).toContain('GROUP BY request_id');
    expect(sql).toContain('ORDER BY request_occurred_at DESC, request_id DESC');
    expect(sql).toContain('LIMIT $1');
  });

  it('batch resolves current contact and company labels without active-status filters', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ request_id: 'r1', schema_name: 'core', table_name: 'medios_contacto', operation: 'INSERT', before_data: null, after_data: { contacto_id: 7, valor: 'a@test.mx' }, occurred_at: '2026-08-25T10:00:00Z' }])
      .mockResolvedValueOnce([{ id: '7', company_id: '8', contact_type: 'PERSONA', name: 'Ana', area: 'Compras' }])
      .mockResolvedValueOnce([{ id: '8', name: 'Acme' }]);
    const repository = new RecentActivityRepository({ query } as never);

    const result = await repository.findRecent(1);

    expect(result.contacts.get('7')?.name).toBe('Ana');
    expect(result.companies.get('8')).toBe('Acme');
    expect(query.mock.calls[1]?.[0]).not.toContain('estatus');
    expect(query.mock.calls[2]?.[0]).not.toContain('estatus');
  });

  it.each([
    ['PROVIDER', ['empresas', 'empresa_roles', 'empresas_fiscales']],
    ['CONTACT', ['contactos', 'medios_contacto']]
  ] as const)('bounds %s request groups after source-category selection', async (category, tables) => {
    const query = vi.fn().mockResolvedValue([]);
    const repository = new RecentActivityRepository({ query } as never);

    await repository.findRecent(6, category);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("HAVING bool_or(schema_name = 'core' AND table_name = ANY($2::text[]))"), [30, tables]);
  });
});

describe('PaymentNotificationActivityRepository', () => {
  it('uses a bounded aggregate query and returns only business classification fields', async () => {
    const rows = [{ execution_state: 'PROCESADO', occurred_at: '2026-08-25T10:00:00.000Z', result_count: 5, ready_count: 4, manual_count: 1, error_count: 0, omitted_count: 0 }];
    const query = vi.fn().mockResolvedValue(rows);
    const repository = new PaymentNotificationActivityRepository({ query } as never);

    await expect(repository.findRecent(6)).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledWith(expect.any(String), [30]);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM core.correos_notificacion_pago correo');
    expect(sql).toContain('LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)');
    expect(sql).toContain("correo.estado IN ('PROCESADO', 'ERROR')");
    expect(sql).toContain('correo.fecha_procesado AS occurred_at');
    expect(sql).toContain('correo.fecha_procesado IS NOT NULL');
    expect(sql).toContain("HAVING correo.estado = 'ERROR' OR count(resultado.correo_id) > 0");
    expect(sql).toContain('ORDER BY correo.fecha_procesado DESC, correo.correo_id DESC');
    expect(sql).toContain('LIMIT $1');
    expect(sql).not.toContain("correo.estado = 'PENDIENTE'");
    expect(sql).not.toMatch(/outlook|remitente|asunto|destinatario|detalle_error|fecha_resumen_enviado/i);
    expect(Object.keys(rows[0]!)).toEqual(['execution_state', 'occurred_at', 'result_count', 'ready_count', 'manual_count', 'error_count', 'omitted_count']);
  });
});

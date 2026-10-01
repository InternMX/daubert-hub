import { describe, expect, it, vi } from 'vitest';
import {
  insertPaymentNotificationSettings,
  PaymentNotificationSettingsRepository,
  syncPaymentNotificationDestination,
  type PaymentNotificationSettingsRow
} from '../src/payment-notification-settings/payment-notification-settings.repository';

const identity = { userId: '5', userEmail: 'user@daubert.mx' };
const DEFAULT_DESTINATION = 'PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}';

function settingsRow(overrides: Partial<PaymentNotificationSettingsRow> = {}): PaymentNotificationSettingsRow {
  return {
    company_id: '7',
    dropbox_path: 'FLETES/TRANSPORTES KARINA',
    has_settings_row: false,
    processes_payment_receipts: false,
    notifications_active: false,
    destination_path: null,
    has_operable_para_recipient: true,
    ...overrides
  };
}

// Dispatches on the SQL text so the tests do not depend on call order.
function fakeClient(state: { companyExists?: boolean; rows: PaymentNotificationSettingsRow[] }) {
  const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
  let selectCount = 0;
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('FOR UPDATE')) return { rows: state.companyExists === false ? [] : [{ '?column?': 1 }] };
    if (sql.includes('has_operable_para_recipient')) return { rows: [state.rows[Math.min(selectCount++, state.rows.length - 1)]] };
    return { rows: [] };
  });
  return { calls, client: { query, release: vi.fn() } };
}

function repositoryWith(client: unknown, database: Record<string, unknown> = {}) {
  return new PaymentNotificationSettingsRepository({ connect: vi.fn().mockResolvedValue(client), ...database } as never);
}

const isReady = (row: PaymentNotificationSettingsRow, next: { processesPaymentReceipts: boolean }) =>
  Boolean(row.dropbox_path) && next.processesPaymentReceipts && row.has_operable_para_recipient;

describe('PaymentNotificationSettingsRepository', () => {
  describe('find', () => {
    it('reads defaults for a company without a settings row (LEFT JOIN + COALESCE, no write)', async () => {
      const query = vi.fn().mockResolvedValue([settingsRow()]);
      const repository = new PaymentNotificationSettingsRepository({ query } as never);
      await expect(repository.find('7')).resolves.toMatchObject({ has_settings_row: false, processes_payment_receipts: false, notifications_active: false });
      const [sql, params] = query.mock.calls[0]!;
      expect(sql).toContain('LEFT JOIN core.empresas_notificacion_pago');
      expect(sql).toContain('COALESCE(settings.procesa_comprobantes_pago, FALSE)');
      expect(sql).toContain('COALESCE(settings.notificaciones_activas, FALSE)');
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
      expect(params).toEqual(['7']);
    });

    it('returns null for an unknown company', async () => {
      const repository = new PaymentNotificationSettingsRepository({ query: vi.fn().mockResolvedValue([]) } as never);
      await expect(repository.find('999')).resolves.toBeNull();
    });

    it('defines an operable PARA recipient explicitly and independently of es_principal', async () => {
      const query = vi.fn().mockResolvedValue([settingsRow()]);
      await new PaymentNotificationSettingsRepository({ query } as never).find('7');
      const sql = query.mock.calls[0]![0] as string;
      expect(sql).toContain("contact.estatus = 'ACTIVO'");
      expect(sql).toContain("method.estatus = 'ACTIVO'");
      expect(sql).toContain("method.tipo_medio = 'CORREO'");
      expect(sql).toContain('method.recibe_notificacion_pago = TRUE');
      expect(sql).toContain("method.tipo_destinatario_pago = 'PARA'");
      expect(sql).not.toContain('es_principal');
    });
  });

  describe('update', () => {
    it('historical company without a row: UPSERTs (INSERT ... ON CONFLICT (empresa_id) DO UPDATE) with a destination derived from its dropbox path', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow({ has_settings_row: false }), settingsRow({ has_settings_row: true, processes_payment_receipts: true })] });
      const result = await repositoryWith(client).update('7', { processesPaymentReceipts: true }, isReady, 'req-1', identity);
      expect(result.status).toBe('UPDATED');
      const upsert = calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!;
      expect(upsert.sql).toContain('ON CONFLICT (empresa_id) DO UPDATE');
      expect(upsert.params).toEqual(['7', true, false, 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}']);
      // The conflict branch never rewrites ruta_destino (historical templates are preserved).
      expect(upsert.sql.split('DO UPDATE')[1]).not.toContain('ruta_destino');
      expect(calls.at(-1)!.sql).toBe('COMMIT');
    });

    it('uses the schema-default destination when the company has no dropbox path', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow({ dropbox_path: null }), settingsRow({ dropbox_path: null, has_settings_row: true })] });
      await repositoryWith(client).update('7', { processesPaymentReceipts: true }, isReady, 'req-1', identity);
      expect(calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!.params?.[3]).toBe(DEFAULT_DESTINATION);
    });

    it('sets the audit context and locks the company row inside one transaction', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow(), settingsRow()] });
      await repositoryWith(client).update('7', { notificationsActive: false }, isReady, 'req-9', identity);
      expect(calls[0]!.sql).toBe('BEGIN');
      expect(calls[1]).toMatchObject({ params: ['DAUBERT_HUB'] });
      expect(calls[2]).toMatchObject({ params: ['req-9'] });
      expect(calls.some((call) => call.sql.includes('FROM core.empresas WHERE empresa_id = $1 FOR UPDATE'))).toBe(true);
    });

    it('does NOT persist notificationsActive=true when readiness fails: rolls back without any write', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow({ has_operable_para_recipient: false })] });
      const result = await repositoryWith(client).update('7', { processesPaymentReceipts: true, notificationsActive: true }, isReady, 'req-1', identity);
      expect(result.status).toBe('NOT_READY');
      expect(calls.some((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))).toBe(false);
      expect(calls.at(-1)!.sql).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('activates a complete company (resulting processing flag counts) and persists true/true', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow(), settingsRow({ has_settings_row: true, processes_payment_receipts: true, notifications_active: true })] });
      const result = await repositoryWith(client).update('7', { processesPaymentReceipts: true, notificationsActive: true }, isReady, 'req-1', identity);
      expect(result.status).toBe('UPDATED');
      expect(calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!.params?.slice(0, 3)).toEqual(['7', true, true]);
    });

    it('deactivation is always allowed: readiness is not evaluated', async () => {
      const notReady = vi.fn().mockReturnValue(false);
      const { client, calls } = fakeClient({ rows: [settingsRow({ has_settings_row: true, notifications_active: true, has_operable_para_recipient: false }), settingsRow({ has_settings_row: true })] });
      const result = await repositoryWith(client).update('7', { notificationsActive: false }, notReady, 'req-1', identity);
      expect(result.status).toBe('UPDATED');
      expect(notReady).not.toHaveBeenCalled();
      expect(calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!.params?.slice(1, 3)).toEqual([false, false]);
    });

    it('keeps the current value of the flag the request omits', async () => {
      const { client, calls } = fakeClient({ rows: [settingsRow({ has_settings_row: true, processes_payment_receipts: true, notifications_active: false }), settingsRow()] });
      await repositoryWith(client).update('7', { notificationsActive: false }, isReady, 'req-1', identity);
      expect(calls.find((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))!.params?.slice(1, 3)).toEqual([true, false]);
    });

    it('returns NOT_FOUND (and commits nothing else) for an unknown company', async () => {
      const { client, calls } = fakeClient({ companyExists: false, rows: [settingsRow()] });
      await expect(repositoryWith(client).update('999', { notificationsActive: false }, isReady, 'req-1', identity)).resolves.toEqual({ status: 'NOT_FOUND' });
      expect(calls.some((call) => call.sql.includes('INSERT INTO core.empresas_notificacion_pago'))).toBe(false);
    });

    it('rolls back and releases the client when the upsert fails', async () => {
      const failure = new Error('permission denied');
      const calls: string[] = [];
      const query = vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes('FOR UPDATE')) return { rows: [{}] };
        if (sql.includes('has_operable_para_recipient')) return { rows: [settingsRow()] };
        if (sql.includes('INSERT INTO core.empresas_notificacion_pago')) throw failure;
        return { rows: [] };
      });
      const client = { query, release: vi.fn() };
      await expect(repositoryWith(client).update('7', { notificationsActive: false }, isReady, 'req-1', identity)).rejects.toBe(failure);
      expect(calls.at(-1)).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});

describe('transaction helpers', () => {
  it('insertPaymentNotificationSettings creates false/false with the derived destination', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await insertPaymentNotificationSettings({ query } as never, '121', 'FLETES/TRANSPORTES KARINA');
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('INSERT INTO core.empresas_notificacion_pago');
    expect(sql).toContain('VALUES ($1, FALSE, FALSE, $2)');
    expect(params).toEqual(['121', 'FLETES\\TRANSPORTES KARINA\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}']);
  });

  it('insertPaymentNotificationSettings without a dropbox path uses the schema default destination (never null)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await insertPaymentNotificationSettings({ query } as never, '121', null);
    expect(query.mock.calls[0]![1]).toEqual(['121', DEFAULT_DESTINATION]);
  });

  it('syncPaymentNotificationDestination creates a MISSING row as false/false with the standard destination (never activated as a side effect)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const kind = await syncPaymentNotificationDestination({ query } as never, '121', null, 'PROVEEDORES/COMPO');
    expect(kind).toBe('NEW');
    expect(query.mock.calls[0]![0]).toContain('FOR UPDATE');
    const [sql, params] = query.mock.calls[1]!;
    expect(sql).toContain('VALUES ($1, FALSE, FALSE, $2)');
    expect(sql).toContain('ON CONFLICT (empresa_id) DO NOTHING');
    expect(params).toEqual(['121', 'PROVEEDORES\\COMPO\\PAGOS\\NOTIFICACIONES DE PAGO\\{ANIO}\\{MES_NUM}.- {MES_NOMBRE_TITULO}']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationsRepository } from '../src/automations/payment-notifications/payment-notifications.repository';

describe('PaymentNotificationsRepository', () => {
  describe('list', () => {
    it('paginates with a stable correo_id ordering and never filters out zero-result executions', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce([{ total: 11 }])
        .mockResolvedValueOnce([]);
      const repository = new PaymentNotificationsRepository({ query } as never);

      await repository.list(2, 25);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]?.[0]).toContain('SELECT count(*)::int AS total FROM core.correos_notificacion_pago');
      const [sql, values] = query.mock.calls[1]!;
      expect(sql).toContain('FROM core.correos_notificacion_pago correo');
      expect(sql).toContain('LEFT JOIN core.resultados_notificacion_pago resultado USING (correo_id)');
      expect(sql).toContain('ORDER BY correo.correo_id DESC');
      expect(sql).not.toContain('HAVING');
      // detalle_error rides on the same single query (no N+1) and is parsed in TypeScript, not SQL.
      expect(sql).toContain('correo.detalle_error AS file_error_detail');
      expect(sql).not.toContain('fecha_recepcion');
      expect(values).toEqual([25, 25]);
    });

    it('returns the total alongside the page of executions', async () => {
      const rows = [{ execution_id: '32', total_results: 5 }];
      const query = vi.fn().mockResolvedValueOnce([{ total: 11 }]).mockResolvedValueOnce(rows);
      const repository = new PaymentNotificationsRepository({ query } as never);

      await expect(repository.list(1, 25)).resolves.toEqual({ total: 11, executions: rows });
    });
  });

  describe('listRecent (Phase 10I)', () => {
    it('orders newest-first by correo_id and binds the limit', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await repository.listRecent(500);
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('FROM core.correos_notificacion_pago correo');
      expect(sql).toContain('ORDER BY correo.correo_id DESC');
      expect(sql).toContain('LIMIT $1');
      expect(values).toEqual([500]);
    });

    it('returns the raw rows unfiltered (outcome derivation stays in the service)', async () => {
      const rows = [{ execution_id: '32', processing_status: 'PROCESADO' }];
      const query = vi.fn().mockResolvedValue(rows);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.listRecent(10)).resolves.toEqual(rows);
    });
  });

  describe('findExecutionById', () => {
    it('binds the executionId as a bigint-cast string parameter', async () => {
      const query = vi.fn().mockResolvedValue([{ execution_id: '9007199254740993' }]);
      const repository = new PaymentNotificationsRepository({ query } as never);

      await expect(repository.findExecutionById('9007199254740993')).resolves.toEqual({ execution_id: '9007199254740993' });
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('WHERE correo.correo_id = $1::bigint');
      expect(values).toEqual(['9007199254740993']);
    });

    it('returns null when no execution matches', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.findExecutionById('999999')).resolves.toBeNull();
    });
  });

  describe('findReprocessableCorreoByExecutionId (PN1.2 targeting fix §4/§5)', () => {
    it('resolves the requested execution when it is currently eligible, binding the executionId as a bigint-cast parameter', async () => {
      const query = vi.fn().mockResolvedValue([{ correo_id: '77', eligible: true }]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.findReprocessableCorreoByExecutionId('77')).resolves.toEqual({ status: 'FOUND', correoId: '77' });
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain("correo.estado = 'ERROR'");
      expect(sql).toContain("correo.estado = 'PROCESADO'");
      expect(sql).toContain("resultado.estado IN ('MANUAL', 'ERROR')");
      expect(sql).toContain('WHERE correo.correo_id = $1::bigint');
      expect(sql).not.toContain('ORDER BY');
      expect(sql).not.toContain('LIMIT');
      expect(values).toEqual(['77']);
    });

    it('returns NOT_ELIGIBLE when the requested execution exists but has no recoverable unresolved work', async () => {
      const query = vi.fn().mockResolvedValue([{ correo_id: '52', eligible: false }]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.findReprocessableCorreoByExecutionId('52')).resolves.toEqual({ status: 'NOT_ELIGIBLE' });
    });

    it('returns NOT_FOUND when no execution matches the requested executionId', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.findReprocessableCorreoByExecutionId('999999')).resolves.toEqual({ status: 'NOT_FOUND' });
    });

    it('never resolves a different execution than the one requested (regression: clicking row A must never reprocess row B)', async () => {
      // Simulates two independently eligible rows (A older, B newer). Requesting A's executionId
      // must bind exactly A's id and never fall back to any "latest"/ORDER BY-based resolution.
      const query = vi.fn().mockResolvedValue([{ correo_id: '40', eligible: true }]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await expect(repository.findReprocessableCorreoByExecutionId('40')).resolves.toEqual({ status: 'FOUND', correoId: '40' });
      const [, values] = query.mock.calls[0]!;
      expect(values).toEqual(['40']);
    });
  });

  describe('reprocess eligibility SQL: list and click-time share the same conditions', () => {
    const ENABLED_OMITIDO = /resultado\.estado = 'OMITIDO'\s+AND np\.procesa_comprobantes_pago IS TRUE\s+AND np\.notificaciones_activas IS TRUE/;
    const HASH_EXPRESSION = "correo.detalle_error ~ 'HASH=[0-9A-Fa-f]{64}'";

    async function capture() {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new PaymentNotificationsRepository({ query } as never);
      await repository.list(1, 25);
      await repository.listRecent(10);
      await repository.findExecutionById('42');
      await repository.findReprocessableCorreoByExecutionId('42');
      await repository.findResultsByExecutionId('42');
      return query.mock.calls.map(([sql]) => sql as string);
    }

    it('list queries count OMITIDO results of currently enabled companies (both flags IS TRUE) through a LEFT JOIN on the primary key, without touching other counts', async () => {
      const listSql = (await capture())[1]!;
      expect(listSql).toMatch(ENABLED_OMITIDO);
      expect(listSql).toContain('LEFT JOIN core.empresas_notificacion_pago np ON np.empresa_id = resultado.empresa_id');
      expect(listSql).toContain('AS reactivated_omitted_count');
      expect(listSql).toContain("count(*) FILTER (WHERE resultado.estado = 'OMITIDO')::int AS omitted_count");
      expect(listSql).toContain('count(resultado.correo_id)::int AS total_results');
      expect(listSql).toContain('GROUP BY correo.correo_id');
    });

    it('list and detail queries expose the pending-HASH flag with the exact n8n expression (HASH=([0-9A-Fa-f]{64}))', async () => {
      const calls = await capture();
      for (const sql of [calls[1]!, calls[2]!, calls[3]!]) {
        expect(sql).toContain(HASH_EXPRESSION);
        expect(sql).toContain('AS has_pending_file_hash');
      }
    });

    it('the click-time query re-evaluates ERROR, MANUAL/ERROR results, enabled OMITIDO and pending HASH against current data, and PENDIENTE is not admitted', async () => {
      const clickSql = (await capture())[4]!;
      expect(clickSql).toContain("correo.estado = 'ERROR'");
      expect(clickSql).toContain("correo.estado = 'PROCESADO'");
      expect(clickSql).not.toContain('PENDIENTE');
      expect(clickSql).toContain("resultado.estado IN ('MANUAL', 'ERROR')");
      expect(clickSql).toMatch(ENABLED_OMITIDO);
      expect(clickSql).toContain('LEFT JOIN core.empresas_notificacion_pago np ON np.empresa_id = resultado.empresa_id');
      expect(clickSql).toContain(HASH_EXPRESSION);
      expect(clickSql).not.toMatch(/\bLISTO\b/);
    });

    it('never writes: no repository query contains INSERT/UPDATE/DELETE or locking clauses', async () => {
      for (const sql of await capture()) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/i);
    });
  });

  describe('findResultsByExecutionId', () => {
    it('left joins core.empresas so a result survives an unresolved company name', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const repository = new PaymentNotificationsRepository({ query } as never);

      await repository.findResultsByExecutionId('32');

      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toContain('LEFT JOIN core.empresas empresa ON empresa.empresa_id = resultado.empresa_id');
      expect(sql).toContain('resultado.empresa_id::text AS company_id');
      expect(sql).toContain('resultado.motivo');
      expect(sql).toContain('WHERE resultado.correo_id = $1::bigint');
      expect(values).toEqual(['32']);
      expect(sql).not.toMatch(/rfc|razon_social|outlook|remitente|asunto|correos_para|correos_cc|correos_cco/i);
    });
  });
});

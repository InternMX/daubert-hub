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

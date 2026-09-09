import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PaymentNotificationsService } from '../src/automations/payment-notifications/payment-notifications.service';

function execution(overrides: Partial<{
  execution_id: string; created_at: string; processed_at: string | null; processing_status: 'PENDIENTE' | 'PROCESADO' | 'ERROR';
  summary_sent: boolean; summary_sent_at: string | null; total_results: number; ready_count: number; manual_count: number; error_count: number; omitted_count: number;
}> = {}) {
  return {
    execution_id: '32',
    created_at: '2026-08-19T19:31:49.884Z',
    processed_at: '2026-08-19T19:31:49.919Z',
    processing_status: 'PROCESADO' as const,
    summary_sent: false,
    summary_sent_at: null,
    total_results: 5,
    ready_count: 4,
    manual_count: 1,
    error_count: 0,
    omitted_count: 0,
    ...overrides
  };
}

describe('PaymentNotificationsService', () => {
  describe('list', () => {
    it('maps pagination meta and per-execution counts, deriving outcomeStatus', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 11, executions: [execution()] }) };
      const service = new PaymentNotificationsService(repository as never);

      const result = await service.list({ page: 1, pageSize: 25 });

      expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 11, totalPages: 1 });
      expect(result.data).toEqual([{
        executionId: '32',
        createdAt: '2026-08-19T19:31:49.884Z',
        processedAt: '2026-08-19T19:31:49.919Z',
        processingStatus: 'PROCESADO',
        outcomeStatus: 'PARTIAL',
        totalResults: 5,
        readyCount: 4,
        manualCount: 1,
        errorCount: 0,
        omittedCount: 0,
        summarySent: false,
        summarySentAt: null
      }]);
      expect(repository.list).toHaveBeenCalledWith(1, 25);
    });

    it('derives COMPLETED when PROCESADO has only LISTO/OMITIDO results', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 1, executions: [execution({ manual_count: 0, ready_count: 5, total_results: 5 })] }) };
      const service = new PaymentNotificationsService(repository as never);
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBe('COMPLETED');
    });

    it('derives FAILED for a top-level ERROR with no useful results', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 1, executions: [execution({ processing_status: 'ERROR', total_results: 0, ready_count: 0, manual_count: 0 })] }) };
      const service = new PaymentNotificationsService(repository as never);
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBe('FAILED');
    });

    it('derives outcomeStatus=null for a PROCESADO execution with zero provider results, never COMPLETED', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 1, executions: [execution({ total_results: 0, ready_count: 0, manual_count: 0, error_count: 0, omitted_count: 0 })] }) };
      const service = new PaymentNotificationsService(repository as never);
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBeNull();
      expect(result.data[0]?.processingStatus).toBe('PROCESADO');
    });

    it('derives outcomeStatus=null for a PENDIENTE execution', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 1, executions: [execution({ processing_status: 'PENDIENTE', total_results: 0, ready_count: 0, manual_count: 0, processed_at: null })] }) };
      const service = new PaymentNotificationsService(repository as never);
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(result.data[0]?.outcomeStatus).toBeNull();
      expect(result.data[0]?.processingStatus).toBe('PENDIENTE');
      expect(result.data[0]?.processedAt).toBeNull();
    });

    it('does not expose any sensitive field on a summary item', async () => {
      const repository = { list: vi.fn().mockResolvedValue({ total: 1, executions: [execution()] }) };
      const service = new PaymentNotificationsService(repository as never);
      const result = await service.list({ page: 1, pageSize: 25 });
      expect(Object.keys(result.data[0]!).sort()).toEqual([
        'createdAt', 'errorCount', 'executionId', 'manualCount', 'omittedCount', 'outcomeStatus',
        'processedAt', 'processingStatus', 'readyCount', 'summarySent', 'summarySentAt', 'totalResults'
      ]);
      expect(JSON.stringify(result)).not.toMatch(/outlook|remitente|asunto|correos_para|correos_cc|correos_cco|rfc|detalle_error|motivo/i);
    });
  });

  describe('getDetail', () => {
    it('returns the execution summary with grouped, BIGINT-safe provider results', async () => {
      const repository = {
        findExecutionById: vi.fn().mockResolvedValue(execution()),
        findResultsByExecutionId: vi.fn().mockResolvedValue([
          { company_id: '9007199254740993', company_name: 'Acme', status: 'LISTO', motivo: null },
          { company_id: '103', company_name: 'Otra', status: 'MANUAL', motivo: 'DESTINATARIOS_PARA' }
        ])
      };
      const service = new PaymentNotificationsService(repository as never);

      const result = await service.getDetail('32');

      expect(result.data.executionId).toBe('32');
      expect(result.data.results).toEqual([
        { companyId: '9007199254740993', companyName: 'Acme', status: 'LISTO', attentionReason: null },
        { companyId: '103', companyName: 'Otra', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' }
      ]);
      expect(typeof result.data.results[0]!.companyId).toBe('string');
      expect(repository.findExecutionById).toHaveBeenCalledWith('32');
      expect(repository.findResultsByExecutionId).toHaveBeenCalledWith('32');
    });

    it('keeps a provider result visible with companyName=null when enrichment cannot resolve it', async () => {
      const repository = {
        findExecutionById: vi.fn().mockResolvedValue(execution()),
        findResultsByExecutionId: vi.fn().mockResolvedValue([{ company_id: '999', company_name: null, status: 'ERROR', motivo: null }])
      };
      const service = new PaymentNotificationsService(repository as never);

      const result = await service.getDetail('32');

      expect(result.data.results).toEqual([{ companyId: '999', companyName: null, status: 'ERROR', attentionReason: null }]);
    });

    it('never exposes an unknown motivo value raw', async () => {
      const repository = {
        findExecutionById: vi.fn().mockResolvedValue(execution()),
        findResultsByExecutionId: vi.fn().mockResolvedValue([{ company_id: '1', company_name: 'Acme', status: 'MANUAL', motivo: 'SOME_UNDOCUMENTED_CODE' }])
      };
      const service = new PaymentNotificationsService(repository as never);

      const result = await service.getDetail('32');

      expect(result.data.results[0]?.attentionReason).toBe('Requiere revisión.');
      expect(JSON.stringify(result)).not.toMatch(/SOME_UNDOCUMENTED_CODE/);
    });

    it('throws NotFoundException for an unknown executionId', async () => {
      const repository = { findExecutionById: vi.fn().mockResolvedValue(null), findResultsByExecutionId: vi.fn() };
      const service = new PaymentNotificationsService(repository as never);

      await expect(service.getDetail('999999')).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findResultsByExecutionId).not.toHaveBeenCalled();
    });
  });
});

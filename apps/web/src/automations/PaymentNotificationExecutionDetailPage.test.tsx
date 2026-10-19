import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPaymentNotificationExecution, PaymentNotificationApiError, type PaymentNotificationExecutionDetail } from '../services/paymentNotifications';
import { PaymentNotificationExecutionDetailPage } from './PaymentNotificationExecutionDetailPage';

vi.mock('../services/paymentNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/paymentNotifications')>()),
  getPaymentNotificationExecution: vi.fn()
}));

const detailMock = vi.mocked(getPaymentNotificationExecution);

function detail(overrides: Partial<PaymentNotificationExecutionDetail> = {}): PaymentNotificationExecutionDetail {
  return {
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
    fileErrors: 0,
    summarySent: false,
    summarySentAt: null,
    reviewStatus: null,
    reprocessAvailable: false,
    results: [],
    fileErrorDetails: [],
    ...overrides
  };
}

function renderPage(executionId = '32') {
  return render(
    <MemoryRouter initialEntries={[`/automations/payment-notifications/${executionId}`]}>
      <Routes><Route path="/automations/payment-notifications/:executionId" element={<PaymentNotificationExecutionDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

describe('PaymentNotificationExecutionDetailPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the outcome, counts, and summary state for the execution', async () => {
    detailMock.mockResolvedValue(detail());
    renderPage();

    expect(await screen.findByText('Parcial')).toBeInTheDocument();
    expect(screen.getByText('5 resultados')).toBeInTheDocument();
    expect(screen.getByText('4 Listos · 1 Manual · 0 Error · 0 Omitidos')).toBeInTheDocument();
    expect(screen.getByText('Resumen no enviado')).toBeInTheDocument();
  });

  describe('file errors ("Archivos que requieren atención")', () => {
    const hash = 'a'.repeat(64);
    const fileErrorDetails = [
      { fileName: '13.-KARINA MEZA.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'KARINA MEZA', fileHash: hash },
      { fileName: '2.-CTO DE ABASTECIMIENT.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'CTO DE ABASTECIMIENT', fileHash: 'b'.repeat(64) }
    ];

    it('shows the section with every file name, error code and detail when fileErrors > 0, separately from company results', async () => {
      detailMock.mockResolvedValue(detail({ outcomeStatus: 'COMPLETED', totalResults: 11, readyCount: 11, manualCount: 0, fileErrors: 2, fileErrorDetails }));
      renderPage();

      const heading = await screen.findByRole('heading', { level: 2, name: 'Archivos que requieren atención' });
      const section = within(heading.closest('section') as HTMLElement);
      expect(section.getByText('13.-KARINA MEZA.pdf')).toBeInTheDocument();
      expect(section.getByText('2.-CTO DE ABASTECIMIENT.pdf')).toBeInTheDocument();
      expect(section.getAllByRole('button', { name: 'Ver detalle' })).toHaveLength(2);
      expect(section.getByText('KARINA MEZA')).toBeInTheDocument();
      expect(section.getByText('CTO DE ABASTECIMIENT')).toBeInTheDocument();
      // The technical hash is a contract for n8n/API, not user-facing content.
      expect(screen.queryByText(hash)).not.toBeInTheDocument();
      // Company universe is untouched: 11 results, 0 errors, file errors reported on their own line.
      expect(screen.getByText('11 resultados')).toBeInTheDocument();
      expect(screen.getByText('11 Listos · 0 Manual · 0 Error · 0 Omitidos')).toBeInTheDocument();
      expect(screen.getByText('2 errores de archivo')).toBeInTheDocument();
      expect(screen.getByText('Completado')).toBeInTheDocument();
    });

    it('does not render the section (nor an empty block) when fileErrors = 0', async () => {
      detailMock.mockResolvedValue(detail());
      renderPage();
      await screen.findByText('Parcial');
      expect(screen.queryByText('Archivos que requieren atención')).not.toBeInTheDocument();
      expect(screen.queryByText(/errores? de archivo/)).not.toBeInTheDocument();
    });

    it('renders markup in file names and details as plain text', async () => {
      detailMock.mockResolvedValue(detail({ fileErrors: 1, fileErrorDetails: [{ fileName: '<b>x</b>.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: '<img src=x onerror=alert(1)>', fileHash: hash }] }));
      const { container } = renderPage();
      expect(await screen.findByText('<b>x</b>.pdf')).toBeInTheDocument();
      expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
      expect(container.querySelector('b, img')).toBeNull();
    });

    it('renders a file error without a detail', async () => {
      detailMock.mockResolvedValue(detail({ fileErrors: 1, fileErrorDetails: [{ fileName: 'x.pdf', errorCode: 'RUTA_NO_VALIDADA', detail: null, fileHash: hash }] }));
      renderPage();
      expect(await screen.findByText('x.pdf')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
      expect(screen.getByText(/RUTA_NO_VALIDADA/)).toBeInTheDocument();
    });
  });

  it('translates every provider result status', async () => {
    detailMock.mockResolvedValue(detail({
      results: [
        { companyId: '1', companyName: 'PLASTISOL', status: 'LISTO', attentionReason: null },
        { companyId: '2', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' },
        { companyId: '3', companyName: 'TRESGUERRAS', status: 'ERROR', attentionReason: 'Requiere revisión.' },
        { companyId: '4', companyName: 'OTRA', status: 'OMITIDO', attentionReason: null }
      ]
    }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Resultados por empresa' });
    expect(within(table).getByText('Listo')).toBeInTheDocument();
    expect(within(table).getByText('Manual')).toBeInTheDocument();
    expect(within(table).getByText('Error')).toBeInTheDocument();
    expect(within(table).getByText('Omitido')).toBeInTheDocument();
    expect(within(table).getByText('Faltan destinatarios principales configurados.')).toBeInTheDocument();
  });

  it('shows a dash for a null attentionReason in the results table', async () => {
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '1', companyName: 'PLASTISOL', status: 'LISTO', attentionReason: null }] }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Resultados por empresa' });
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('falls back to "Empresa no disponible" when companyName is null', async () => {
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '1', companyName: null, status: 'ERROR', attentionReason: null }] }));
    renderPage();
    expect(await screen.findByText('Empresa no disponible')).toBeInTheDocument();
  });

  it('shows the zero-result empty state for the detail table', async () => {
    detailMock.mockResolvedValue(detail({ results: [] }));
    renderPage();
    expect(await screen.findByText('Esta ejecución no tiene resultados por empresa registrados.')).toBeInTheDocument();
  });

  it('shows a not-found state for a 404 and a link back to the list', async () => {
    detailMock.mockRejectedValue(new PaymentNotificationApiError(404));
    renderPage('999999999999999');

    expect(await screen.findByText('No se encontró la ejecución solicitada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a notificaciones de pago' })).toHaveAttribute('href', '/automations/payment-notifications');
  });

  it('shows a generic retryable error for a non-404 failure', async () => {
    detailMock.mockRejectedValue(new PaymentNotificationApiError(500));
    renderPage();
    expect(await screen.findByText('No fue posible cargar la ejecución. Intenta nuevamente.')).toBeInTheDocument();
  });

  it('never renders the raw executionId or companyId as visible content', async () => {
    detailMock.mockResolvedValue(detail({ executionId: '9007199254740993', results: [{ companyId: '9007199254740993', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: null }] }));
    renderPage('9007199254740993');
    await screen.findByText('NOVAPAK');
    expect(screen.queryByText('9007199254740993')).not.toBeInTheDocument();
  });
});

import { render, screen, within } from '@testing-library/react';
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
    summarySent: false,
    summarySentAt: null,
    reviewStatus: null,
    reprocessAvailable: false,
    results: [],
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

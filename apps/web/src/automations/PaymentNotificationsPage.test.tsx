import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPaymentNotificationExecution,
  listPaymentNotificationExecutions,
  type ListPaymentNotificationExecutions,
  type PaymentNotificationExecutionDetail,
  type PaymentNotificationExecutionSummary
} from '../services/paymentNotifications';
import { PaymentNotificationsPage } from './PaymentNotificationsPage';

vi.mock('../services/paymentNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/paymentNotifications')>()),
  listPaymentNotificationExecutions: vi.fn(),
  getPaymentNotificationExecution: vi.fn()
}));

const listMock = vi.mocked(listPaymentNotificationExecutions);
const detailMock = vi.mocked(getPaymentNotificationExecution);

function summary(overrides: Partial<PaymentNotificationExecutionSummary> = {}): PaymentNotificationExecutionSummary {
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
    ...overrides
  };
}

function listResponse(data: PaymentNotificationExecutionSummary[], meta: Partial<ListPaymentNotificationExecutions['meta']> = {}): ListPaymentNotificationExecutions {
  return { data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1, ...meta } };
}

function detail(overrides: Partial<PaymentNotificationExecutionDetail> = {}): PaymentNotificationExecutionDetail {
  return { ...summary(), results: [], ...overrides };
}

function renderPage() { return render(<MemoryRouter><PaymentNotificationsPage /></MemoryRouter>); }

describe('PaymentNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detailMock.mockResolvedValue(detail());
  });

  function latestSection() {
    return screen.getByRole('heading', { level: 2, name: 'Última ejecución' }).closest('section') as HTMLElement;
  }

  it('renders the latest execution timestamp (processedAt), outcome, and all four counters', async () => {
    const latest = summary();
    listMock.mockResolvedValue(listResponse([latest]));
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    const section = within(latestSection());
    expect(section.getByText('Parcial')).toBeInTheDocument();
    expect(section.getByText('5 resultados')).toBeInTheDocument();
    expect(section.getByText('4 Listos · 1 Manual · 0 Error · 0 Omitidos')).toBeInTheDocument();
    expect(section.getByText(/19 ago 2026/)).toBeInTheDocument();
  });

  it('falls back to createdAt when processedAt is null, and never renders Invalid Date', async () => {
    const latest = summary({ processedAt: null, createdAt: '2026-01-05T10:00:00.000Z' });
    listMock.mockResolvedValue(listResponse([latest]));
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(within(latestSection()).getByText(/5 ene 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it.each([
    ['COMPLETED', 'Completado'],
    ['PARTIAL', 'Parcial'],
    ['FAILED', 'Fallido']
  ] as const)('renders the %s outcome as %s', async (outcomeStatus, label) => {
    listMock.mockResolvedValue(listResponse([summary({ outcomeStatus })]));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(within(latestSection()).getByText(label)).toBeInTheDocument();
  });

  it('renders a null outcomeStatus as "Sin resultado disponible", never as Completado, and shows the processing state separately', async () => {
    listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: null, processingStatus: 'PROCESADO', totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
    renderPage();

    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    const section = within(latestSection());
    expect(section.getByText('Sin resultado disponible')).toBeInTheDocument();
    expect(section.queryByText('Completado')).not.toBeInTheDocument();
    expect(section.getByText('0 resultados')).toBeInTheDocument();
    expect(section.getByText('Estado de procesamiento: Procesado')).toBeInTheDocument();
  });

  it('never presents a PROCESADO execution with zero results as Completado', async () => {
    listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(within(latestSection()).queryByText('Completado')).not.toBeInTheDocument();
  });

  it('shows the summary-sent and summary-not-sent states', async () => {
    listMock.mockResolvedValue(listResponse([summary({ summarySent: true })]));
    const first = renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(within(latestSection()).getByText(/Resumen enviado/)).toBeInTheDocument();
    first.unmount();

    vi.clearAllMocks();
    detailMock.mockResolvedValue(detail());
    listMock.mockResolvedValue(listResponse([summary({ summarySent: false })]));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(within(latestSection()).getByText('Resumen no enviado')).toBeInTheDocument();
  });

  it('shows a MANUAL attention item with its sanitized reason and company name', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '7', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' }] }));
    renderPage();

    expect(await screen.findByText('NOVAPAK')).toBeInTheDocument();
    expect(screen.getByText('Faltan destinatarios principales configurados.')).toBeInTheDocument();
    expect(within(screen.getByText('NOVAPAK').closest('div')!.parentElement!).getByText('Manual')).toBeInTheDocument();
  });

  it('shows an ERROR attention item', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '9', companyName: 'PLASTISOL', status: 'ERROR', attentionReason: 'Requiere revisión.' }] }));
    renderPage();

    expect(await screen.findByText('PLASTISOL')).toBeInTheDocument();
    expect(screen.getAllByText('Requiere revisión.').length).toBeGreaterThan(0);
  });

  it('falls back to "Empresa no disponible" when companyName is null', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '9', companyName: null, status: 'ERROR', attentionReason: null }] }));
    renderPage();

    expect(await screen.findByText('Empresa no disponible')).toBeInTheDocument();
    expect(screen.getByText('Requiere revisión.')).toBeInTheDocument();
  });

  it('excludes LISTO/OMITIDO results from the attention section and shows the positive empty state', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '1', companyName: 'A', status: 'LISTO', attentionReason: null }, { companyId: '2', companyName: 'B', status: 'OMITIDO', attentionReason: null }] }));
    renderPage();

    expect(await screen.findByText('La última ejecución no requiere atención.')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('shows the compact positive empty state (never a large success banner) when nothing needs attention', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [] }));
    renderPage();
    expect(await screen.findByText('La última ejecución no requiere atención.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the recent executions table with a request through the API pagination, and links to detail', async () => {
    listMock.mockResolvedValue(listResponse([summary()], { page: 1, pageSize: 25, total: 40, totalPages: 2 }));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
    const link = within(table).getByRole('link');
    expect(link).toHaveAttribute('href', '/automations/payment-notifications/32');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(2, 25));
  });

  it('does not fetch all pages client-side: pagination always issues a fresh request with the new page', async () => {
    listMock.mockResolvedValue(listResponse([summary()], { page: 1, pageSize: 25, total: 60, totalPages: 3 }));
    renderPage();
    await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
    expect(listMock).toHaveBeenCalledTimes(2); // one for latest (page 1, pageSize 1), one for the table
  });

  it('keeps the latest summary and recent table visible when only the attention detail request fails', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockRejectedValue(new Error('boom'));
    renderPage();

    expect(await screen.findByText('No fue posible cargar los proveedores que requieren atención.')).toBeInTheDocument();
    expect(within(latestSection()).getByText('Parcial')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no executions at all', async () => {
    listMock.mockResolvedValue(listResponse([], { total: 0, totalPages: 0 }));
    renderPage();
    expect(await screen.findByText('Aún no hay ejecuciones registradas.')).toBeInTheDocument();
    expect(detailMock).not.toHaveBeenCalled();
  });

  it('never renders the raw executionId or companyId as visible operational content', async () => {
    listMock.mockResolvedValue(listResponse([summary({ executionId: '9007199254740993' })]));
    detailMock.mockResolvedValue(detail({ results: [{ companyId: '9007199254740993', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: null }] }));
    renderPage();

    await screen.findByText('NOVAPAK');
    expect(screen.queryByText('9007199254740993')).not.toBeInTheDocument();
  });
});

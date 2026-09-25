import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarContext } from '../components/sidebarContext.core';
import { acknowledgeAutomationReview } from '../services/automationsOverview';
import {
  getPaymentNotificationExecution,
  listPaymentNotificationExecutions,
  PaymentNotificationApiError,
  reprocessPaymentNotifications,
  type ListPaymentNotificationExecutions,
  type PaymentNotificationExecutionDetail,
  type PaymentNotificationExecutionSummary
} from '../services/paymentNotifications';
import { PaymentNotificationsPage } from './PaymentNotificationsPage';

vi.mock('../services/paymentNotifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/paymentNotifications')>()),
  listPaymentNotificationExecutions: vi.fn(),
  getPaymentNotificationExecution: vi.fn(),
  reprocessPaymentNotifications: vi.fn()
}));
vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  acknowledgeAutomationReview: vi.fn()
}));

const listMock = vi.mocked(listPaymentNotificationExecutions);
const detailMock = vi.mocked(getPaymentNotificationExecution);
const acknowledgeMock = vi.mocked(acknowledgeAutomationReview);
const reprocessMock = vi.mocked(reprocessPaymentNotifications);

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
    fileErrors: 0,
    summarySent: false,
    summarySentAt: null,
    reviewStatus: null,
    reprocessAvailable: false,
    ...overrides
  };
}

function listResponse(data: PaymentNotificationExecutionSummary[], meta: Partial<ListPaymentNotificationExecutions['meta']> = {}): ListPaymentNotificationExecutions {
  return { data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1, ...meta } };
}

function detail(overrides: Partial<PaymentNotificationExecutionDetail> = {}): PaymentNotificationExecutionDetail {
  return { ...summary(), results: [], fileErrorDetails: [], ...overrides };
}

function renderPage() { return render(<MemoryRouter><PaymentNotificationsPage /></MemoryRouter>); }

// Same technique as AppShell.test.tsx's mockWideViewport, extended to answer every distinct media
// query (the page now queries both the `md` and `lg` breakpoints independently) by parsing each
// query's own max-width and comparing it against a single mutable "current viewport width" — so
// both breakpoints stay consistent with one simulated width instead of being controlled separately.
const VIEWPORT_BELOW_MD = 800; // < 900
const VIEWPORT_MD_TO_LG = 1000; // >= 900, < 1200
const VIEWPORT_AT_LEAST_LG = 1300; // >= 1200

function mockViewportWidth(initialWidthPx: number) {
  let currentWidth = initialWidthPx;
  const registered = new Map<string, { mql: MediaQueryList; listeners: Set<(event: MediaQueryListEvent) => void> }>();

  function matchesFor(query: string): boolean {
    const maxWidth = /max-width:\s*([\d.]+)px/.exec(query)?.[1];
    return maxWidth !== undefined && currentWidth <= Number(maxWidth);
  }

  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    let entry = registered.get(query);
    if (!entry) {
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const mql = {
        get matches() { return matchesFor(query); },
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
        dispatchEvent: () => true
      } as MediaQueryList;
      entry = { mql, listeners };
      registered.set(query, entry);
    }
    return entry.mql;
  }));

  return (widthPx: number) => {
    currentWidth = widthPx;
    act(() => {
      for (const { mql, listeners } of registered.values()) {
        listeners.forEach((listener) => listener({ matches: mql.matches, media: mql.media } as MediaQueryListEvent));
      }
    });
  };
}

// Simulates AppShell's own SidebarContext.Provider (see AppShell.tsx) — the shared mechanism the
// page reads sidebar state from, without measuring any DOM/drawer width.
function renderPageWithSidebar(collapsed: boolean) {
  return render(
    <SidebarContext.Provider value={{ collapsed }}>
      <MemoryRouter><PaymentNotificationsPage /></MemoryRouter>
    </SidebarContext.Provider>
  );
}

describe('PaymentNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detailMock.mockResolvedValue(detail());
    acknowledgeMock.mockResolvedValue({ automationCode: 'PAYMENT_NOTIFICATIONS', reviewRequired: false, reviewedAt: '2026-09-10T00:00:00.000Z', reviewedBy: { displayName: 'user@daubert.mx', email: 'user@daubert.mx' } });
    reprocessMock.mockResolvedValue(undefined);
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

  describe('production-state status mapping (PN1.2 production findings)', () => {
    it('renders PENDIENTE as "Pendiente" — never "Sin resultado disponible" — as the primary status label', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PENDIENTE', outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
      const section = within(latestSection());
      expect(section.getByText('Pendiente')).toBeInTheDocument();
      expect(section.queryByText('Sin resultado disponible')).not.toBeInTheDocument();
      // The chip already says "Pendiente" — the redundant secondary line is only for the other
      // null-outcome case (a completed PROCESADO run with zero results).
      expect(section.queryByText('Estado de procesamiento: Pendiente')).not.toBeInTheDocument();
    });

    it('renders PROCESADO with 13 results (12 LISTO / 1 MANUAL) as "Parcial", a confirmed real production shape', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PROCESADO', outcomeStatus: 'PARTIAL', totalResults: 13, readyCount: 12, manualCount: 1, errorCount: 0, omittedCount: 0 })]));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
      expect(within(latestSection()).getByText('Parcial')).toBeInTheDocument();
    });

    it('renders PROCESADO with all LISTO as "Completado"', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PROCESADO', outcomeStatus: 'COMPLETED', totalResults: 5, readyCount: 5, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
      expect(within(latestSection()).getByText('Completado')).toBeInTheDocument();
    });
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

  it('shows a compact empty state (never a large success banner, and never a positive claim) when there are no results at all', async () => {
    // PN1.2 production findings: a PROCESADO execution with zero results is a real historical shape
    // (older workflow stages), not proof the run was evaluated and found healthy — so this must not
    // say "no requiere atención" either.
    listMock.mockResolvedValue(listResponse([summary()]));
    detailMock.mockResolvedValue(detail({ results: [] }));
    renderPage();
    expect(await screen.findByText('No hay información detallada disponible para esta ejecución.')).toBeInTheDocument();
    expect(screen.queryByText('La última ejecución no requiere atención.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  describe('PENDIENTE attention copy (PN1.2 final semantics)', () => {
    it('says the execution is still in progress, never "no requiere atención", when PENDIENTE with no results yet', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PENDIENTE', outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
      detailMock.mockResolvedValue(detail({ processingStatus: 'PENDIENTE', outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0, results: [] }));
      renderPage();

      expect(await screen.findByText('La ejecución todavía está en proceso.')).toBeInTheDocument();
      expect(screen.queryByText('La última ejecución no requiere atención.')).not.toBeInTheDocument();
    });

    it('does not claim "no requiere atención" when PENDIENTE even with historical MANUAL results present', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PENDIENTE', outcomeStatus: null })]));
      detailMock.mockResolvedValue(detail({
        processingStatus: 'PENDIENTE',
        outcomeStatus: null,
        results: [{ companyId: '7', companyName: 'NOVAPAK', status: 'MANUAL', attentionReason: 'Faltan destinatarios principales configurados.' }]
      }));
      renderPage();

      await screen.findByText('NOVAPAK');
      expect(screen.queryByText('La última ejecución no requiere atención.')).not.toBeInTheDocument();
    });

    it('keeps the positive "no requiere atención" copy for a PROCESADO execution with real, healthy results', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PROCESADO' })]));
      detailMock.mockResolvedValue(detail({ processingStatus: 'PROCESADO', results: [{ companyId: '1', companyName: 'A', status: 'LISTO', attentionReason: null }] }));
      renderPage();

      expect(await screen.findByText('La última ejecución no requiere atención.')).toBeInTheDocument();
      expect(screen.queryByText('La ejecución todavía está en proceso.')).not.toBeInTheDocument();
      expect(screen.queryByText('No hay información detallada disponible para esta ejecución.')).not.toBeInTheDocument();
    });

    it('uses neutral copy — never "no requiere atención" — for a PROCESADO execution with zero historical results (older workflow stage rows)', async () => {
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PROCESADO', outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0 })]));
      detailMock.mockResolvedValue(detail({ processingStatus: 'PROCESADO', outcomeStatus: null, totalResults: 0, readyCount: 0, manualCount: 0, errorCount: 0, omittedCount: 0, results: [] }));
      renderPage();

      expect(await screen.findByText('No hay información detallada disponible para esta ejecución.')).toBeInTheDocument();
      expect(screen.queryByText('La última ejecución no requiere atención.')).not.toBeInTheDocument();
      expect(screen.queryByText('La ejecución todavía está en proceso.')).not.toBeInTheDocument();
    });
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

  describe('Revisión column (Phase 10I UX refinement)', () => {
    it('shows a "Marcar como revisado" action for the row with reviewStatus REQUIRED', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).getByRole('button', { name: 'Marcar como revisado' })).toBeInTheDocument();
    });

    it('shows "Revisado" (not the action) for the row with reviewStatus REVIEWED', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REVIEWED' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(await within(table).findByText('Revisado')).toBeInTheDocument();
      expect(within(table).queryByRole('button', { name: 'Marcar como revisado' })).not.toBeInTheDocument();
    });

    it('shows a plain dash for a non-current row (reviewStatus null), even a historical PARTIAL/FAILED one', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'PARTIAL', reviewStatus: null })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).queryByRole('button', { name: 'Marcar como revisado' })).not.toBeInTheDocument();
      expect(within(table).queryByText('Revisado')).not.toBeInTheDocument();
    });

    it('opens the confirmation dialog, and Cancelar sends no request', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Marcar como revisado' }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(acknowledgeMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('acknowledges without sending any processing/source ID, then refreshes the latest card and table and shows a success Snackbar', async () => {
      listMock
        .mockResolvedValueOnce(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })])) // latest (page 1, pageSize 1)
        .mockResolvedValueOnce(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })])) // table
        .mockResolvedValueOnce(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REVIEWED' })])) // latest refresh
        .mockResolvedValueOnce(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REVIEWED' })])); // table refresh
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Marcar como revisado' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Marcar como revisado' }));

      expect(acknowledgeMock).toHaveBeenCalledWith('PAYMENT_NOTIFICATIONS');
      expect(acknowledgeMock.mock.calls[0]).toEqual(['PAYMENT_NOTIFICATIONS']);
      expect(await screen.findByText('Marcado como revisado.')).toBeInTheDocument();
      await waitFor(() => expect(within(screen.getByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' })).getByText('Revisado')).toBeInTheDocument());
    });

    it('keeps the action available and shows a safe Spanish error on failure, without a raw API error', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })]));
      acknowledgeMock.mockRejectedValueOnce(new Error('boom'));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Marcar como revisado' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Marcar como revisado' }));

      expect(await within(dialog).findByText('No fue posible marcar la automatización como revisada. Intenta nuevamente.')).toBeInTheDocument();
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Marcar como revisado' })).toBeInTheDocument();
    });
  });

  // PN1.2 final scope cleanup: "Ejecutar ahora" was removed — the production n8n workflow already
  // polls independently, so a manual run trigger added no value. Reprocesar (below) is unaffected.
  it('no longer renders an "Ejecutar ahora" button anywhere on the page', async () => {
    listMock.mockResolvedValue(listResponse([summary()]));
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
    expect(screen.queryByRole('button', { name: 'Ejecutar ahora' })).not.toBeInTheDocument();
  });

  describe('Reprocesar (PN1.2 §4/§5/§11/§13)', () => {
    it('renders Reprocesar only when reprocessAvailable is true, independent of reviewStatus', async () => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: false, reviewStatus: 'REQUIRED' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Marcar como revisado' })).toBeInTheDocument();
    });

    it('renders both Reprocesar and Marcar como revisado together when both apply (the IZZI case: PARTIAL, 4 LISTO/1 MANUAL/0 ERROR)', async () => {
      // summary()'s defaults already model this exact scenario (readyCount:4, manualCount:1,
      // errorCount:0, outcomeStatus:'PARTIAL') — PN1.2 correction §12's confirmed UI requirement.
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true, reviewStatus: 'REQUIRED' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).getByRole('button', { name: 'Reprocesar' })).toBeInTheDocument();
      expect(within(table).getByRole('button', { name: 'Marcar como revisado' })).toBeInTheDocument();
    });

    it('opens a confirmation dialog with the exact required copy, and Cancelar sends no request', async () => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true })]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Se reevaluará el correo con la información actual. El trabajo que ya se completó correctamente no se volverá a generar intencionalmente.')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      expect(reprocessMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('sends the row\'s exact executionId (no correo_id) in the path, refreshes the table, and shows "Reproceso solicitado." on confirm', async () => {
      listMock
        .mockResolvedValueOnce(listResponse([summary({ executionId: '32', reprocessAvailable: true })])) // latest
        .mockResolvedValueOnce(listResponse([summary({ executionId: '32', reprocessAvailable: true })])) // table
        .mockResolvedValueOnce(listResponse([summary({ executionId: '32', reprocessAvailable: false })])) // latest refresh
        .mockResolvedValueOnce(listResponse([summary({ executionId: '32', reprocessAvailable: false })])); // table refresh
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(reprocessMock).toHaveBeenCalledWith('32');
      expect(await screen.findByText('Reproceso solicitado.')).toBeInTheDocument();
      await waitFor(() => expect(within(screen.getByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' })).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument());
    });

    // Regression for the confirmed targeting bug (PN1.2 targeting fix): two historical rows both
    // MANUAL/reprocessAvailable=true, B newer than A. Clicking Reprocesar on the OLDER row (A)
    // must call the API with A's own executionId, never B's — list ordering must never leak into
    // which id is sent.
    it('clicking Reprocesar on an older eligible row targets that row\'s executionId, never a newer eligible row\'s', async () => {
      const rowA = summary({ executionId: '40', outcomeStatus: 'PARTIAL', reprocessAvailable: true });
      const rowB = summary({ executionId: '41', outcomeStatus: 'PARTIAL', reprocessAvailable: true });
      // Newest-first ordering, as the real API returns: B (41) before A (40).
      listMock.mockResolvedValue(listResponse([rowB, rowA]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      const reprocessButtons = within(table).getAllByRole('button', { name: 'Reprocesar' });
      expect(reprocessButtons).toHaveLength(2);

      // Second row rendered is A (the older one, executionId 40).
      await user.click(reprocessButtons[1]!);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(reprocessMock).toHaveBeenCalledWith('40');
      expect(reprocessMock).not.toHaveBeenCalledWith('41');
    });

    it('clicking Reprocesar on the newer eligible row (B) targets B\'s executionId, never A\'s', async () => {
      const rowA = summary({ executionId: '40', outcomeStatus: 'PARTIAL', reprocessAvailable: true });
      const rowB = summary({ executionId: '41', outcomeStatus: 'PARTIAL', reprocessAvailable: true });
      listMock.mockResolvedValue(listResponse([rowB, rowA]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      const reprocessButtons = within(table).getAllByRole('button', { name: 'Reprocesar' });

      // First row rendered is B (the newer one, executionId 41).
      await user.click(reprocessButtons[0]!);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(reprocessMock).toHaveBeenCalledWith('41');
      expect(reprocessMock).not.toHaveBeenCalledWith('40');
    });

    it('keeps the action available and shows a safe Spanish error on failure', async () => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true })]));
      reprocessMock.mockRejectedValueOnce(new Error('boom'));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(await within(dialog).findByText('No fue posible solicitar el reproceso. Intenta nuevamente.')).toBeInTheDocument();
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    });

    it.each([
      [409, 'Esta ejecución ya no se puede reprocesar.'],
      [404, 'La ejecución solicitada ya no está disponible.'],
      [502, 'El servicio de automatización no está disponible en este momento. Intenta nuevamente más tarde.'],
      [503, 'El servicio de automatización no está disponible en este momento. Intenta nuevamente más tarde.']
    ] as const)('shows a sanitized, status-specific message for a %i response, never a raw status/body', async (status, message) => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true })]));
      reprocessMock.mockRejectedValueOnce(new PaymentNotificationApiError(status));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(await within(dialog).findByText(message)).toBeInTheDocument();
      expect(screen.queryByText(String(status))).not.toBeInTheDocument();
      // The row must remain independently actionable after a failed request — a failed Hub→n8n
      // delivery is never allowed to lock the row the way an accepted 202 does (PN1.2 final semantics §6).
      await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Reprocesar' })).toBeEnabled();
    });

    it('disables the same row\'s Reprocesar action after a 202, even if the next read still shows it eligible, without calling it "completado"/"procesado"/"exitoso"', async () => {
      // The refetch after acceptance still reports reprocessAvailable: true — proving the row is
      // disabled locally, not because reprocessAvailable ever flips server-side (PN1.2 final
      // semantics §4/§5: a 202 is not proof of completion, so the read model may legitimately still
      // show the prior state on the very next read).
      listMock.mockResolvedValue(listResponse([summary({ executionId: '32', reprocessAvailable: true })]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      const button = within(table).getByRole('button', { name: 'Reprocesar' });
      await user.click(button);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      expect(reprocessMock).toHaveBeenCalledOnce();
      await waitFor(() => expect(within(table).getByRole('button', { name: 'Reprocesar' })).toBeDisabled());

      // A second click while disabled must never fire a second request — userEvent itself refuses
      // to click a pointer-events:none (disabled) button, which is exactly the guarantee here.
      await expect(user.click(within(table).getByRole('button', { name: 'Reprocesar' }))).rejects.toThrow();
      expect(reprocessMock).toHaveBeenCalledOnce();

      expect(screen.queryByText('Reprocesado correctamente')).not.toBeInTheDocument();
      expect(screen.queryByText('Reproceso completado')).not.toBeInTheDocument();
      expect(screen.queryByText('Procesado correctamente')).not.toBeInTheDocument();
    });

    it('does not mutate outcomeStatus/processingStatus/result counts locally on a 202 — only the existing refetch may change them', async () => {
      // A confirmed real production shape (PN1.2 production findings): PROCESADO with a MANUAL
      // result is not test-only data. Same unchanged row on every subsequent read — the point is
      // that clicking Reprocesar alone must never locally flip outcomeStatus/processingStatus/counts
      // to something else.
      const partialRow = summary({ executionId: '32', reprocessAvailable: true, processingStatus: 'PROCESADO', outcomeStatus: 'PARTIAL', totalResults: 5, readyCount: 4, manualCount: 1, errorCount: 0, omittedCount: 0 });
      listMock.mockResolvedValue(listResponse([partialRow]));
      detailMock.mockResolvedValue(detail(partialRow));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Reprocesar' }));

      await screen.findByText('Reproceso solicitado.');
      expect(within(latestSection()).getByText('Parcial')).toBeInTheDocument();
      expect(within(latestSection()).getByText('4 Listos · 1 Manual · 0 Error · 0 Omitidos')).toBeInTheDocument();
      expect(acknowledgeMock).not.toHaveBeenCalled();
    });

    it('never presents Reprocesar as actionable while an execution is still PENDIENTE, even when reprocessAvailable is true', async () => {
      // PN1.2 production findings §4: PENDIENTE must not offer Reprocesar — n8n already refuses a
      // second claim while pending, but the UI must represent that truthfully rather than offering
      // an action that would only be rejected. No new backend lock is added.
      listMock.mockResolvedValue(listResponse([summary({ processingStatus: 'PENDIENTE', outcomeStatus: null, reprocessAvailable: true })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
    });

    it('reprocessing does not call acknowledgeAutomationReview, and marking reviewed does not call reprocessPaymentNotifications', async () => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true, reviewStatus: 'REQUIRED' })]));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });

      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      await user.click((await screen.findByRole('dialog')).querySelector('button:last-child')!);
      await waitFor(() => expect(reprocessMock).toHaveBeenCalledOnce());
      expect(acknowledgeMock).not.toHaveBeenCalled();

      await user.click(within(screen.getByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' })).getByRole('button', { name: 'Marcar como revisado' }));
      await user.click((await screen.findByRole('dialog')).querySelector('button:last-child')!);
      await waitFor(() => expect(acknowledgeMock).toHaveBeenCalledOnce());
      expect(reprocessMock).toHaveBeenCalledOnce(); // still only the earlier call — never called again
    });
  });

  describe('file errors (Errores archivo)', () => {
    const hash = 'a'.repeat(64);
    const fileErrorDetails = [
      { fileName: '13.-KARINA MEZA.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'KARINA MEZA', fileHash: hash },
      { fileName: '2.-CTO DE ABASTECIMIENT.pdf', errorCode: 'ALIAS_NO_CATALOGADO', detail: 'CTO DE ABASTECIMIENT', fileHash: 'b'.repeat(64) }
    ];
    const elevenReadyWithFileErrors = summary({ outcomeStatus: 'COMPLETED', totalResults: 11, readyCount: 11, manualCount: 0, errorCount: 0, omittedCount: 0, fileErrors: 2 });

    // Reads the first body row as { columnHeader: cellText } so each count is asserted under its own header.
    async function firstRowByHeader() {
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent ?? '');
      const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell').map((cell) => cell.textContent ?? '');
      return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    }

    it('shows "Errores archivo" with its count in the table, next to (not merged into) the company counts', async () => {
      listMock.mockResolvedValue(listResponse([elevenReadyWithFileErrors]));
      renderPage();
      const row = await firstRowByHeader();
      expect(row['Errores archivo']).toBe('2');
      expect(row['Total empresas']).toBe('11');
      expect(row['Listos']).toBe('11');
      expect(row['Error']).toBe('0');
    });

    it('keeps company Error = 0 and Errores archivo = 2 as separate values', async () => {
      listMock.mockResolvedValue(listResponse([summary({ errorCount: 0, fileErrors: 2 })]));
      renderPage();
      const row = await firstRowByHeader();
      expect(row['Error']).toBe('0');
      expect(row['Errores archivo']).toBe('2');
    });

    it('shows 0 under "Errores archivo" when there are none', async () => {
      listMock.mockResolvedValue(listResponse([summary()]));
      renderPage();
      expect((await firstRowByHeader())['Errores archivo']).toBe('0');
    });

    it('mentions the file errors in the latest-execution card only when there are some, without touching the company counts line', async () => {
      listMock.mockResolvedValue(listResponse([elevenReadyWithFileErrors]));
      detailMock.mockResolvedValue(detail({ ...elevenReadyWithFileErrors, fileErrorDetails }));
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Última ejecución' });
      const card = within(latestSection());
      expect(card.getByText('11 resultados')).toBeInTheDocument();
      expect(card.getByText('11 Listos · 0 Manual · 0 Error · 0 Omitidos')).toBeInTheDocument();
      expect(card.getByText('2 errores de archivo')).toBeInTheDocument();
    });

    it('lists the file errors under "Archivos que requieren atención" for the latest execution and never claims it needs no attention', async () => {
      listMock.mockResolvedValue(listResponse([elevenReadyWithFileErrors]));
      detailMock.mockResolvedValue(detail({ ...elevenReadyWithFileErrors, fileErrorDetails }));
      renderPage();
      const heading = await screen.findByRole('heading', { level: 2, name: 'Archivos que requieren atención' });
      const section = within(heading.closest('section') as HTMLElement);
      expect(section.getByText('13.-KARINA MEZA.pdf')).toBeInTheDocument();
      expect(section.getByText('2.-CTO DE ABASTECIMIENT.pdf')).toBeInTheDocument();
      expect(section.getAllByText('ALIAS_NO_CATALOGADO')).toHaveLength(2);
      expect(section.getByText('KARINA MEZA')).toBeInTheDocument();
      expect(screen.queryByText('La última ejecución no requiere atención.')).not.toBeInTheDocument();
    });

    it('renders no file-errors section, and keeps the healthy message, when fileErrors = 0 (also for a historical row without details)', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'COMPLETED', totalResults: 5, readyCount: 5, manualCount: 0 })]));
      detailMock.mockResolvedValue(detail({ outcomeStatus: 'COMPLETED', totalResults: 5, readyCount: 5, manualCount: 0, results: [{ companyId: '1', companyName: 'A', status: 'LISTO', attentionReason: null }] }));
      renderPage();
      expect(await screen.findByText('La última ejecución no requiere atención.')).toBeInTheDocument();
      expect(screen.queryByText('Archivos que requieren atención')).not.toBeInTheDocument();
      expect(screen.queryByText(/errores? de archivo/)).not.toBeInTheDocument();
    });

    it('still renders PARTIAL as "Parcial" when the row also has file errors', async () => {
      listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'PARTIAL', fileErrors: 2 })]));
      detailMock.mockResolvedValue(detail({ outcomeStatus: 'PARTIAL', fileErrors: 2, fileErrorDetails }));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).getByText('Parcial')).toBeInTheDocument();
    });

    it('applies the same Reprocesar rules as before: visible only when reprocessAvailable, whatever the file errors', async () => {
      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: false, fileErrors: 2 })]));
      const { unmount } = renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
      unmount();

      listMock.mockResolvedValue(listResponse([summary({ reprocessAvailable: true, fileErrors: 2 })]));
      renderPage();
      const table2 = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(within(table2).getByRole('button', { name: 'Reprocesar' })).toBeEnabled();
    });

    it('Reprocesar sends only the executionId (no file hashes or file list) to the service', async () => {
      listMock.mockResolvedValue(listResponse([summary({ executionId: '77', reprocessAvailable: true, fileErrors: 2 })]));
      detailMock.mockResolvedValue(detail({ executionId: '77', reprocessAvailable: true, fileErrors: 2, fileErrorDetails }));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      await user.click(within(table).getByRole('button', { name: 'Reprocesar' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reprocesar' }));
      expect(reprocessMock).toHaveBeenCalledOnce();
      expect(reprocessMock.mock.calls[0]).toEqual(['77']);
    });
  });

  describe('responsive recent-executions columns (three viewport tiers × sidebar state)', () => {
    const DETAIL_COLUMNS = ['Listos', 'Manual', 'Error', 'Omitidos', 'Errores archivo'];
    const ALWAYS_VISIBLE_COLUMNS = ['Fecha', 'Resultado', 'Total empresas', 'Resumen', 'Revisión'];
    const FULL: readonly string[] = ['table-cell', 'table-cell', 'table-cell', 'table-cell', 'table-cell'];
    const COMPACT: readonly string[] = ['none', 'none', 'none', 'none', 'none'];

    // The six meaningful (viewport tier × sidebar state) combinations and their expected outcome,
    // per the refined rule: compact = viewportBelowMd || (sidebarExpanded && viewportBelowLg).
    const COMBINATIONS = [
      { label: '<900 + collapsed', width: VIEWPORT_BELOW_MD, sidebarCollapsed: true, expectCompact: true, outcome: 'compact' },
      { label: '<900 + expanded', width: VIEWPORT_BELOW_MD, sidebarCollapsed: false, expectCompact: true, outcome: 'compact' },
      { label: '900–1199 + collapsed', width: VIEWPORT_MD_TO_LG, sidebarCollapsed: true, expectCompact: false, outcome: 'full' },
      { label: '900–1199 + expanded', width: VIEWPORT_MD_TO_LG, sidebarCollapsed: false, expectCompact: true, outcome: 'compact' },
      { label: '>=1200 + collapsed', width: VIEWPORT_AT_LEAST_LG, sidebarCollapsed: true, expectCompact: false, outcome: 'full' },
      { label: '>=1200 + expanded', width: VIEWPORT_AT_LEAST_LG, sidebarCollapsed: false, expectCompact: false, outcome: 'full' }
    ] as const;

    function detailColumnDisplays() {
      return DETAIL_COLUMNS.map((label) => getComputedStyle(screen.getAllByText(label, { selector: 'th, td' })[0]!).display);
    }

    afterEach(() => vi.unstubAllGlobals());

    it.each(COMBINATIONS)('$label → $outcome columns', async ({ width, sidebarCollapsed, expectCompact }) => {
      listMock.mockResolvedValue(listResponse([summary()]));
      mockViewportWidth(width);
      renderPageWithSidebar(sidebarCollapsed);
      await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });

      expect(detailColumnDisplays()).toEqual(expectCompact ? COMPACT : FULL);
    });

    it.each(ALWAYS_VISIBLE_COLUMNS)('%s stays visible in every combination', async (label) => {
      for (const { width, sidebarCollapsed } of COMBINATIONS) {
        listMock.mockResolvedValue(listResponse([summary({ outcomeStatus: 'FAILED', reviewStatus: 'REQUIRED' })]));
        mockViewportWidth(width);
        const { unmount } = renderPageWithSidebar(sidebarCollapsed);
        await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
        expect(getComputedStyle(screen.getAllByText(label, { selector: 'th, td' })[0]!).display).not.toBe('none');
        unmount();
      }
    });

    it('toggling sidebar state within the md–lg tier updates visible columns immediately, with no refetch', async () => {
      listMock.mockResolvedValue(listResponse([summary()]));
      mockViewportWidth(VIEWPORT_MD_TO_LG);
      const { rerender } = render(
        <SidebarContext.Provider value={{ collapsed: true }}>
          <MemoryRouter><PaymentNotificationsPage /></MemoryRouter>
        </SidebarContext.Provider>
      );
      await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(detailColumnDisplays()).toEqual(FULL);
      const callsBeforeToggle = listMock.mock.calls.length;

      rerender(
        <SidebarContext.Provider value={{ collapsed: false }}>
          <MemoryRouter><PaymentNotificationsPage /></MemoryRouter>
        </SidebarContext.Provider>
      );

      expect(detailColumnDisplays()).toEqual(COMPACT);
      expect(listMock.mock.calls.length).toBe(callsBeforeToggle);
    });

    it('sidebar toggle has no effect once viewport reaches lg — stays full, with no refetch', async () => {
      listMock.mockResolvedValue(listResponse([summary()]));
      mockViewportWidth(VIEWPORT_AT_LEAST_LG);
      const { rerender } = render(
        <SidebarContext.Provider value={{ collapsed: true }}>
          <MemoryRouter><PaymentNotificationsPage /></MemoryRouter>
        </SidebarContext.Provider>
      );
      await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(detailColumnDisplays()).toEqual(FULL);
      const callsBeforeToggle = listMock.mock.calls.length;

      rerender(
        <SidebarContext.Provider value={{ collapsed: false }}>
          <MemoryRouter><PaymentNotificationsPage /></MemoryRouter>
        </SidebarContext.Provider>
      );

      expect(detailColumnDisplays()).toEqual(FULL);
      expect(listMock.mock.calls.length).toBe(callsBeforeToggle);
    });

    it('viewport change alone (sidebar unchanged, expanded) moves between compact and full across all three tiers, with no refetch', async () => {
      listMock.mockResolvedValue(listResponse([summary()]));
      const setViewportWidth = mockViewportWidth(VIEWPORT_AT_LEAST_LG);
      renderPageWithSidebar(false); // sidebar expanded throughout
      await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(detailColumnDisplays()).toEqual(FULL); // >=lg: full even though expanded
      const callsAfterMount = listMock.mock.calls.length;

      setViewportWidth(VIEWPORT_MD_TO_LG);
      expect(detailColumnDisplays()).toEqual(COMPACT); // md..<lg + expanded: compact

      setViewportWidth(VIEWPORT_BELOW_MD);
      expect(detailColumnDisplays()).toEqual(COMPACT); // <md: compact regardless

      setViewportWidth(VIEWPORT_AT_LEAST_LG);
      expect(detailColumnDisplays()).toEqual(FULL); // back to >=lg: full again

      expect(listMock.mock.calls.length).toBe(callsAfterMount);
    });

    it('keeps the table wrapper horizontally scrollable as the final fallback for very narrow screens', async () => {
      listMock.mockResolvedValue(listResponse([summary()]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      const scrollWrapper = table.parentElement!;
      expect(getComputedStyle(scrollWrapper).overflowX).toBe('auto');
    });

    it.each(COMBINATIONS)('does not fork into a separate mobile table ($label) — exactly one table renders', async ({ width, sidebarCollapsed }) => {
      listMock.mockResolvedValue(listResponse([summary()]));
      mockViewportWidth(width);
      renderPageWithSidebar(sidebarCollapsed);
      await screen.findByRole('table', { name: 'Ejecuciones recientes de notificaciones de pago' });
      expect(screen.getAllByRole('table').length).toBe(1);
    });
  });
});

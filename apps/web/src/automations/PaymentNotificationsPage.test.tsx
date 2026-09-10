import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarContext } from '../components/sidebarContext.core';
import { acknowledgeAutomationReview } from '../services/automationsOverview';
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
vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  acknowledgeAutomationReview: vi.fn()
}));

const listMock = vi.mocked(listPaymentNotificationExecutions);
const detailMock = vi.mocked(getPaymentNotificationExecution);
const acknowledgeMock = vi.mocked(acknowledgeAutomationReview);

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
    reviewStatus: null,
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

  describe('responsive recent-executions columns (three viewport tiers × sidebar state)', () => {
    const DETAIL_COLUMNS = ['Listos', 'Manual', 'Error', 'Omitidos'];
    const ALWAYS_VISIBLE_COLUMNS = ['Fecha', 'Resultado', 'Total', 'Resumen', 'Revisión'];
    const FULL: readonly string[] = ['table-cell', 'table-cell', 'table-cell', 'table-cell'];
    const COMPACT: readonly string[] = ['none', 'none', 'none', 'none'];

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

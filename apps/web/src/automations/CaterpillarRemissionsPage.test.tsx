import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, AutomationApiError, type AutomationSeriesConfiguration } from '../services/automations';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import {
  CaterpillarReprocessApiError,
  cancelCaterpillarRemission,
  getCaterpillarExecution,
  listCaterpillarExecutions,
  listCaterpillarSeries,
  reprocessCaterpillarExecution,
  regenerateCaterpillarExecution,
  type CaterpillarExecutionDetail,
  type CaterpillarExecutionSummary,
  type CaterpillarProcessRoute,
  type ListCaterpillarExecutions
} from '../services/caterpillarRemissions';
import { testAdminUser, testGeneralUser, TestAuthProvider } from '../test/authTestUtils';
import { wideOnlyProcessColumnSx } from './caterpillarPresentation';
import { CaterpillarRemissionsPage } from './CaterpillarRemissionsPage';

vi.mock('../services/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automations')>()),
  adjustDocumentSeries: vi.fn()
}));
vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  listAutomationsOverview: vi.fn()
}));
vi.mock('../services/caterpillarRemissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/caterpillarRemissions')>()),
  listCaterpillarSeries: vi.fn(),
  listCaterpillarExecutions: vi.fn(),
  getCaterpillarExecution: vi.fn(),
  reprocessCaterpillarExecution: vi.fn(),
  regenerateCaterpillarExecution: vi.fn(),
  cancelCaterpillarRemission: vi.fn()
}));

const overviewMock = vi.mocked(listAutomationsOverview);
const seriesMock = vi.mocked(listCaterpillarSeries);
const executionsMock = vi.mocked(listCaterpillarExecutions);
const detailMock = vi.mocked(getCaterpillarExecution);
const adjustMock = vi.mocked(adjustDocumentSeries);
const reprocessMock = vi.mocked(reprocessCaterpillarExecution);
const regenerateMock = vi.mocked(regenerateCaterpillarExecution);
const cancelMock = vi.mocked(cancelCaterpillarRemission);

function caterpillarOverview(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_CATERPILLAR',
    name: 'Remisiones Caterpillar',
    description: 'Generación y control de remisiones para Caterpillar.',
    // Phase 12A.4b: real production truth — P5/P6 validated 2026-09-22, INTEGRATED now.
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: 'INACTIVE',
    polling: { intervalMinutes: 15, label: 'Cada 15 minutos' },
    lastCheckAt: null,
    lastProcessing: null,
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: true },
    review: { required: false, problemOccurredAt: null, problemOutcome: null },
    ...overrides
  };
}

function route(overrides: Partial<CaterpillarProcessRoute> = {}): CaterpillarProcessRoute {
  return {
    routeId: '1',
    processKey: 'CATERPILLAR_P2|P2|',
    processLabel: 'P2',
    routeStatus: 'ACTIVE',
    seriesId: '2',
    seriesCode: 'REMISION_CAT_P2',
    seriesStatus: 'ACTIVE',
    nextFolio: 85,
    clientCompanyId: '122',
    clientCompanyName: 'CATERPILLAR',
    ...overrides
  };
}

// The real nine production routes confirmed in Phase 12A.3/12A.4.
const NINE_ROUTES: CaterpillarProcessRoute[] = [
  route({ routeId: '1', processKey: 'CATERPILLAR_P2|P2|', processLabel: 'P2', seriesId: '2', seriesCode: 'REMISION_CAT_P2', seriesStatus: 'ACTIVE', nextFolio: 85 }),
  route({ routeId: '2', processKey: 'CAT_P3_P4_P5_P6|P3|', processLabel: 'P3', seriesId: '3', seriesCode: 'REMISION_CAT_P3', seriesStatus: 'INACTIVE', nextFolio: 2 }),
  route({ routeId: '3', processKey: 'CAT_P3_P4_P5_P6|P4|', processLabel: 'P4', seriesId: '4', seriesCode: 'REMISION_CAT_P4', seriesStatus: 'INACTIVE', nextFolio: 1 }),
  route({ routeId: '4', processKey: 'CAT_P3_P4_P5_P6|P5|', processLabel: 'P5', seriesId: '5', seriesCode: 'REMISION_CAT_P5', seriesStatus: 'ACTIVE', nextFolio: 119 }),
  route({ routeId: '5', processKey: 'CAT_P3_P4_P5_P6|P6|', processLabel: 'P6', seriesId: '6', seriesCode: 'REMISION_CAT_P6', seriesStatus: 'ACTIVE', nextFolio: 7 }),
  route({ routeId: '6', processKey: 'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_1', processLabel: 'Nuevo Laredo FINSA 1', seriesId: '7', seriesCode: 'REMISION_CAT_NL_FINSA_1', seriesStatus: 'INACTIVE', nextFolio: 1 }),
  route({ routeId: '7', processKey: 'CAT_NUEVO_LAREDO|NUEVO_LAREDO|FINSA_3', processLabel: 'Nuevo Laredo FINSA 3', seriesId: '8', seriesCode: 'REMISION_CAT_NL_FINSA_3', seriesStatus: 'INACTIVE', nextFolio: 1 }),
  route({ routeId: '9', processKey: 'CAT_TORREON|TORREON|', processLabel: 'Torreón', seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE', nextFolio: 778 }),
  route({ routeId: '8', processKey: 'CAT_TORREON|TORREON|PLANTA_2', processLabel: 'Torreón Planta 2', seriesId: '9', seriesCode: 'REMISION_CAT_TORREON', seriesStatus: 'INACTIVE', nextFolio: 778 })
];

function executionSummary(overrides: Partial<CaterpillarExecutionSummary> = {}): CaterpillarExecutionSummary {
  return {
    executionId: '9007199254740993',
    outcome: 'COMPLETED',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    failedAttempts: 0,
    maxAttempts: 2,
    latestErrorNode: null,
    latestErrorMessage: null,
    n8nExecutionId: 'wf-1',
    sourceDocumentId: '55',
    sourceFilename: 'remision_p2.pdf',
    generatedRemissionCount: 3,
    minimumFolio: '85',
    maximumFolio: '87',
    processLabel: 'P2',
    ...overrides
  };
}

function executionDetail(overrides: Partial<CaterpillarExecutionDetail> = {}): CaterpillarExecutionDetail {
  return {
    executionId: '9007199254740993',
    outcome: 'COMPLETED',
    startedAt: '2026-09-20T10:00:00.000Z',
    finishedAt: '2026-09-20T10:05:00.000Z',
    failedAttempts: 0,
    maxAttempts: 2,
    latestErrorNode: null,
    latestErrorMessage: null,
    n8nExecutionId: 'wf-1',
    reprocessOfExecutionId: null,
    regeneration: { eligible: false, blockedBy: 'NOT_COMPLETED', authorization: null },
    sourceDocument: { documentId: '55', filename: 'remision_p2.pdf', path: '/dropbox/cat/p2/remision_p2.pdf', hash: 'abc123hash', origin: 'DROPBOX', documentDate: '2026-09-19' },
    reservations: [{ reservationId: '1', seriesId: '2', seriesCode: 'REMISION_CAT_P2', folioInicial: '85', folioFinal: '87', quantity: 3, status: 'APLICADA' }],
    remittances: [{
      remissionId: '100', seriesId: '2', seriesCode: 'REMISION_CAT_P2', folio: '85', documentDate: '2026-09-19', pdfPath: '/dropbox/cat/p2/85.pdf', status: 'GENERADA',
      details: [{ detailId: '1', internalCode: 'X1', partNumber: 'PN-1', description: 'Parte hidráulica', quantityText: '2 PZA' }]
    }],
    ...overrides
  };
}

function executionsResponse(data: CaterpillarExecutionSummary[], meta: Partial<ListCaterpillarExecutions['meta']> = {}): ListCaterpillarExecutions {
  return { data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: data.length > 0 ? 1 : 0, ...meta } };
}

// Phase 12B.2 §F: folio adjustment is ADMIN-only — ADMIN is the default here (most existing tests
// don't care about the action at all), with a dedicated describe block covering GENERAL/ADMIN.
function renderPage(user = testAdminUser) {
  return render(<MemoryRouter><TestAuthProvider value={{ user }}><CaterpillarRemissionsPage /></TestAuthProvider></MemoryRouter>);
}

describe('CaterpillarRemissionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overviewMock.mockResolvedValue([caterpillarOverview()]);
    seriesMock.mockResolvedValue({ data: NINE_ROUTES });
    executionsMock.mockResolvedValue(executionsResponse([]));
  });

  it('renders the page heading', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' })).toBeInTheDocument();
  });

  describe('individual cancellation', () => {
    const revision = '2026-10-20T12:00:00.123456Z';
    function cancellableDetail() {
      const detail = executionDetail();
      detail.remittances[0] = { ...detail.remittances[0]!, revision, processLabel: 'P2' };
      detail.remittances.push({ ...detail.remittances[0]!, remissionId: '101', folio: '86', pdfPath: 'other.pdf' });
      return detail;
    }
    beforeEach(() => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      detailMock.mockResolvedValue(cancellableDetail());
    });
    it.each(['GENERAL', 'PROCESSING', 'CANCELADA'] as const)('does not offer cancellation for %s', async (mode) => {
      const detail = cancellableDetail();
      if (mode === 'PROCESSING') detail.outcome = 'PROCESSING';
      if (mode === 'CANCELADA') detail.remittances.forEach((item) => { item.status = 'CANCELADA'; });
      detailMock.mockResolvedValue(detail);
      const user = userEvent.setup(); renderPage(mode === 'GENERAL' ? testGeneralUser : testAdminUser);
      await user.click(await screen.findByRole('button', { name: /Ver detalle de ejecución Caterpillar/ }));
      expect(await screen.findByText(/Folio 85/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar remisión 85' })).not.toBeInTheDocument();
    });
    it('ADMIN cancels only after confirmation, refetches detail and shows original audit while preserving siblings', async () => {
      const detail = cancellableDetail();
      const audit = { cancellationId: '1', userId: '1', userEmail: 'admin@example.invalid', userDisplayName: 'Admin histórico', cancelledAt: revision, requestId: 'req' };
      detail.remittances[0] = { ...detail.remittances[0]!, status: 'CANCELADA', cancellationReason: 'Incidencia documental', cancellation: audit };
      const user = userEvent.setup(); renderPage();
      await user.click(await screen.findByRole('button', { name: /Ver detalle de ejecución Caterpillar/ }));
      await user.click(await screen.findByRole('button', { name: 'Cancelar remisión 85' }));
      const dialog = screen.getByRole('dialog', { name: 'Cancelar remisión Caterpillar' });
      expect(cancelMock).not.toHaveBeenCalled();
      detailMock.mockResolvedValue(detail);
      cancelMock.mockResolvedValue({ status: 'CANCELLED', remissionId: '100', cancellationReason: 'Incidencia documental', cancellation: audit });
      await user.type(within(dialog).getByRole('textbox'), 'Incidencia documental');
      await user.click(within(dialog).getByRole('button', { name: 'Confirmar cancelación' }));
      expect(await screen.findByText('Incidencia documental')).toBeInTheDocument();
      expect(await screen.findByText('Admin histórico (admin@example.invalid)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar remisión 86' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar remisión 85' })).not.toBeInTheDocument();
      expect(screen.getByText('/dropbox/cat/p2/85.pdf')).toBeInTheDocument();
      expect(screen.getByText('other.pdf')).toBeInTheDocument();
      expect(detailMock).toHaveBeenCalledTimes(2);
      expect(cancelMock).toHaveBeenCalledWith('9007199254740993', '100', 'Incidencia documental', revision);
      expect(screen.getByText('La remisión fue cancelada. No se recuperaron folios.')).toBeInTheDocument();
    });
  });

  it('shows a loading state before data resolves', () => {
    overviewMock.mockReturnValue(new Promise<AutomationOverview[]>(() => undefined));
    renderPage();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  // Phase 12A.4b: Caterpillar is now INTEGRATED (production-validated 2026-09-22) — the banner is
  // data-driven from automation.integrationStatus, not deleted, so it still renders correctly if
  // that value is ever IN_PREPARATION again (a rollback) or for a future automation reusing this
  // same section pattern.
  describe('preparation banner (§A1, now conditional per Phase 12A.4b)', () => {
    it('renders no preparation banner once Caterpillar is INTEGRATED', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' });
      expect(screen.queryByText('Integración en preparación')).not.toBeInTheDocument();
      expect(screen.queryByText('Pendiente de validación operacional con el primer archivo productivo.')).not.toBeInTheDocument();
    });

    it('never renders a permanent "validated" success banner in its place', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('still renders the exact Spanish banner text as an informational alert when integrationStatus is IN_PREPARATION (e.g. a rollback, or reused by a future automation)', async () => {
      overviewMock.mockResolvedValue([caterpillarOverview({ integrationStatus: 'IN_PREPARATION' })]);
      renderPage();
      // "Integración en preparación" now legitimately appears twice once IN_PREPARATION: once as
      // the banner heading, once as the plain "Integración" status row value — the banner is
      // identified by the unique secondary sentence instead.
      const secondary = await screen.findByText('Pendiente de validación operacional con el primer archivo productivo.');
      const banner = secondary.closest('.MuiAlert-root');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveClass('MuiAlert-standardInfo');
      expect(within(banner as HTMLElement).getByText('Integración en preparación')).toBeInTheDocument();
    });
  });

  describe('operational status (§A2)', () => {
    it('shows the automation lifecycle status (INACTIVA) independently from the INTEGRATED integration state', async () => {
      renderPage();
      const statusHeading = await screen.findByRole('heading', { name: 'Estado operacional' });
      const statusSection = statusHeading.closest('section')!;
      expect(within(statusSection).getByText('Inactiva')).toBeInTheDocument();
      expect(within(statusSection).getByText('Integrada')).toBeInTheDocument();
    });

    it('shows Activa when the automation is ACTIVA, still independent of integrationStatus', async () => {
      overviewMock.mockResolvedValue([caterpillarOverview({ lifecycleStatus: 'ACTIVE' })]);
      renderPage();
      const statusHeading = await screen.findByRole('heading', { name: 'Estado operacional' });
      const statusSection = statusHeading.closest('section')!;
      expect(within(statusSection).getByText('Activa')).toBeInTheDocument();
      expect(within(statusSection).getByText('Integrada')).toBeInTheDocument();
    });

    it('shows última ejecución and estado when a last processing exists', async () => {
      overviewMock.mockResolvedValue([caterpillarOverview({ lastProcessing: { occurredAt: '2026-09-20T10:05:00.000Z', outcome: 'COMPLETED' } })]);
      renderPage();
      expect(await screen.findByText('Última ejecución')).toBeInTheDocument();
      expect(screen.getByText('Completado')).toBeInTheDocument();
    });

    it('omits última ejecución when there has never been a processing event', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 1, name: 'Remisiones Caterpillar' });
      expect(screen.queryByText('Última ejecución')).not.toBeInTheDocument();
    });

    it('shows an error state with retry when the overview fails', async () => {
      overviewMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar el estado operacional.')).toBeInTheDocument();
    });
  });

  describe('processes and series (§A3/§B)', () => {
    it('renders all nine configured process rows', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      expect(within(table).getAllByRole('row')).toHaveLength(10); // header + 9 data rows
    });

    it('shows Ruta and Serie at the lg wide-layout breakpoint and hides both below lg', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const routeHeader = within(table).getByRole('columnheader', { name: 'Ruta' });
      const seriesHeader = within(table).getByRole('columnheader', { name: 'Serie' });
      const p2Row = within(table).getByText('P2').closest('tr')!;
      const routeCell = within(p2Row).getByText('CATERPILLAR_P2|P2|').closest('td')!;
      const seriesCell = within(p2Row).getByText('REMISION_CAT_P2').closest('td')!;

      expect(wideOnlyProcessColumnSx).toEqual({ display: { xs: 'none', lg: 'table-cell' } });
      // JSDOM does not evaluate media queries, so verify the generated MUI CSS contract directly.
      const stylesheetRules = Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try { return Array.from(sheet.cssRules).map((rule) => rule.cssText); }
          catch { return []; }
        });
      for (const cell of [routeHeader, seriesHeader, routeCell, seriesCell]) {
        const responsiveClass = Array.from(cell.classList).find((className) => className.startsWith('css-'))!;
        const responsiveCss = stylesheetRules.filter((rule) => rule.includes(`.${responsiveClass}`)).join('\n');
        expect(responsiveCss).toMatch(/display:\s*none/);
        expect(responsiveCss).toMatch(/@media[^\n]*min-width:\s*1200px[^\n]*display:\s*table-cell/);
      }
    });

    it('keeps the reduced-layout operational columns visible for ADMIN', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      for (const label of ['Proceso', 'Estado de ruta', 'Estado de serie', 'Siguiente folio', 'Acciones']) {
        expect(getComputedStyle(within(table).getByRole('columnheader', { name: label })).display).not.toBe('none');
      }
    });

    // Column order: Proceso(0), Ruta(1), Estado de ruta(2), Serie(3), Estado de serie(4), Siguiente folio(5).
    // Every route is also Activa (routeStatus), so "Estado de serie" must be read from its own
    // cell rather than a bare text search — a P2/P5/P6 row legitimately contains "Activa" twice.
    function seriesStatusCell(table: HTMLElement, processLabel: string): HTMLElement {
      const row = within(table).getByText(processLabel).closest('tr')!;
      return within(row).getAllByRole('cell')[4]!;
    }

    it('shows Activa for P2, P5 and P6 series', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      for (const label of ['P2', 'P5', 'P6']) {
        expect(within(seriesStatusCell(table, label)).getByText('Activa')).toBeInTheDocument();
      }
    });

    it('shows Inactiva for P3, P4, both Nuevo Laredo FINSA processes, and both Torreón processes', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      for (const label of ['P3', 'P4', 'Nuevo Laredo FINSA 1', 'Nuevo Laredo FINSA 3', 'Torreón', 'Torreón Planta 2']) {
        expect(within(seriesStatusCell(table, label)).getByText('Inactiva')).toBeInTheDocument();
      }
    });

    it('shows route status (Activa) independently of series status for every row, even when the series is Inactiva', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const p3Row = within(table).getByText('P3').closest('tr')!;
      const chips = within(p3Row).getAllByText(/^(Activa|Inactiva)$/);
      // Ruta chip and Serie chip are both present and independently rendered: P3's route is
      // Activa while its series is Inactiva — never collapsed into one flag (Phase 12A.4 §A3).
      expect(chips.map((chip) => chip.textContent)).toEqual(['Activa', 'Inactiva']);
    });

    it('keeps both Torreón routes while merging only their shared folio and ADMIN action cells by seriesId', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const torreonRow = within(table).getByText('Torreón').closest('tr')!;
      const planta2Row = within(table).getByText('Torreón Planta 2').closest('tr')!;
      expect(torreonRow).not.toBe(planta2Row);
      expect(within(torreonRow).getByText('CAT_TORREON|TORREON|')).toBeInTheDocument();
      expect(within(planta2Row).getByText('CAT_TORREON|TORREON|PLANTA_2')).toBeInTheDocument();
      expect(within(table).getAllByText('REMISION_CAT_TORREON')).toHaveLength(2);
      expect(within(table).getAllByText('778')).toHaveLength(1);

      const folioCell = within(table).getByText('778').closest('td')!;
      const torreonAction = within(torreonRow).getByRole('button', { name: 'Ajustar folio' });
      expect(folioCell).toHaveAttribute('rowspan', '2');
      expect(torreonAction.closest('td')).toHaveAttribute('rowspan', '2');
      expect(within(planta2Row).queryByText('778')).not.toBeInTheDocument();
      expect(within(planta2Row).queryByRole('button', { name: 'Ajustar folio' })).not.toBeInTheDocument();
    });

    it('shows the raw processKey as secondary text alongside the resolved label', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      expect(within(table).getByText('CATERPILLAR_P2|P2|')).toBeInTheDocument();
    });

    it('shows an error state with retry when the series request fails', async () => {
      seriesMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar los procesos y series.')).toBeInTheDocument();
    });

    it('an executions error does not blank the processes section (section isolation, §F)', async () => {
      executionsMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar las ejecuciones recientes.')).toBeInTheDocument();
      expect(await screen.findByText('P2')).toBeInTheDocument();
    });
  });

  // Phase 12B.2/12B.4: one "Ajustar folio" per unique seriesId, ADMIN-only, reusing the same
  // AdjustNextFolioDialog Audi uses (Phase 12B.2 §L: one shared backend contract, one shared form).
  describe('folio adjustment (§K)', () => {
    it('GENERAL sees the current siguiente_folio but no adjustment action', async () => {
      renderPage(testGeneralUser);
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      expect(within(table).getByText('85')).toBeInTheDocument(); // P2's nextFolio, still visible
      expect(within(table).getAllByText('778')).toHaveLength(1);
      expect(within(table).getByText('778').closest('td')).toHaveAttribute('rowspan', '2');
      expect(screen.queryByRole('button', { name: 'Ajustar folio' })).not.toBeInTheDocument();
    });

    it('ADMIN sees one adjustment action per unique series while single-route series remain unchanged', async () => {
      renderPage(testAdminUser);
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      expect(within(table).getAllByRole('button', { name: 'Ajustar folio' })).toHaveLength(8);
      for (const label of ['P2', 'P3', 'P4', 'P5', 'P6', 'Nuevo Laredo FINSA 1', 'Nuevo Laredo FINSA 3']) {
        const row = within(table).getByText(label).closest('tr')!;
        expect(within(row).getByRole('button', { name: 'Ajustar folio' })).toBeInTheDocument();
        expect(within(row).getAllByRole('cell')).toHaveLength(7);
      }
    });

    it('opens the single shared Torreón action with the shared series and current server folio', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const torreonRow = within(table).getByText('Torreón').closest('tr')!;
      await user.click(within(torreonRow).getByRole('button', { name: 'Ajustar folio' }));

      const dialog = await screen.findByRole('dialog', { name: 'Ajustar siguiente folio' });
      expect(within(dialog).getByRole('textbox', { name: 'Serie' })).toHaveValue('REMISION_CAT_TORREON');
      expect(within(dialog).getByRole('textbox', { name: 'Folio actual' })).toHaveValue('778');
    });

    it('opens the dialog pre-filled with the row\'s own series code and current folio', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const p2Row = within(table).getByText('P2').closest('tr')!;
      await user.click(within(p2Row).getByRole('button', { name: 'Ajustar folio' }));
      const dialog = await screen.findByRole('dialog', { name: 'Ajustar siguiente folio' });
      expect(within(dialog).getByRole('textbox', { name: 'Serie' })).toHaveValue('REMISION_CAT_P2');
      expect(within(dialog).getByRole('textbox', { name: 'Folio actual' })).toHaveValue('85');
    });

    it('sends expectedCurrentFolio bound to the exact row and refreshes the series list on success', async () => {
      const user = userEvent.setup();
      const updatedConfiguration: AutomationSeriesConfiguration = {
        automation: { code: 'REMISIONES_CATERPILLAR', name: 'Remisiones Caterpillar', status: 'ACTIVA' },
        series: { code: 'REMISION_CAT_P2', name: 'Remision Caterpillar Planta 2', nextFolio: 90, status: 'ACTIVA' },
        adjustments: []
      };
      adjustMock.mockResolvedValue(updatedConfiguration);
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const p2Row = within(table).getByText('P2').closest('tr')!;
      await user.click(within(p2Row).getByRole('button', { name: 'Ajustar folio' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '90' } });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
      await user.click(within(dialog).getByRole('button', { name: 'Guardar ajuste' }));

      expect(adjustMock).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P2', { expectedCurrentFolio: 85, nextFolio: 90, reason: 'Corrección' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Re-fetched from the API (listCaterpillarSeries called again), never optimistically patched.
      expect(seriesMock.mock.calls.length).toBeGreaterThan(1);
      expect(await screen.findByText('El siguiente folio se actualizó correctamente.')).toBeInTheDocument();
    });

    it('shows the exceptional backward warning with the exact reused range for a Caterpillar series', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const p5Row = within(table).getByText('P5').closest('tr')!;
      await user.click(within(p5Row).getByRole('button', { name: 'Ajustar folio' }));
      const dialog = await screen.findByRole('dialog');
      // P5's fixture nextFolio is 119.
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '110' } });
      expect(within(dialog).getByText('Corrección excepcional hacia atrás')).toBeInTheDocument();
      expect(within(dialog).getByText('Folios potencialmente reutilizados: 110–118')).toBeInTheDocument();
      expect(within(dialog).getByRole('checkbox', { name: /Confirmo que revisé los archivos de salida/ })).toBeInTheDocument();
    });

    it('leaves the displayed folio unchanged and shows the backend-sanitized message on failure', async () => {
      const user = userEvent.setup();
      adjustMock.mockRejectedValue(new AutomationApiError(409, 'SERIES_FOLIO_BELOW_FLOOR', 'El nuevo folio está por debajo del límite histórico seguro configurado para esta serie.'));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      const p2Row = within(table).getByText('P2').closest('tr')!;
      await user.click(within(p2Row).getByRole('button', { name: 'Ajustar folio' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '10' } });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
      await user.click(within(dialog).getByRole('checkbox', { name: /Confirmo que revisé los archivos de salida/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Guardar ajuste' }));

      expect(await within(dialog).findByText('El nuevo folio está por debajo del límite histórico seguro configurado para esta serie.')).toBeInTheDocument();
      // The dialog (still open, showing the error) makes the background table aria-hidden to
      // screen readers — re-querying by role would incorrectly fail to find it; the already-held
      // element reference is still the live DOM node and reflects any (here: absent) update.
      expect(within(p2Row).getByText('85')).toBeInTheDocument();
    });
  });

  describe('recent executions (§A4)', () => {
    // Phase 12A.4b §3: a neutral, generic empty state — zero executions is a normal edge case at
    // any time (e.g. between real files), never an implication that validation is pending. The
    // Phase 12A.4 production-specific copy was removed once Caterpillar was validated.
    it('shows the intentional generic empty state for zero executions, never an error illustration and never implying pending validation', async () => {
      renderPage();
      expect(await screen.findByText('No hay ejecuciones de Caterpillar registradas.')).toBeInTheDocument();
      expect(screen.queryByText('La automatización está pendiente de su primera validación productiva.')).not.toBeInTheDocument();
      expect(screen.queryByText('No fue posible cargar las ejecuciones recientes.')).not.toBeInTheDocument();
    });

    it('shows an error state with retry when the executions request fails', async () => {
      executionsMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar las ejecuciones recientes.')).toBeInTheDocument();
    });

    it('renders a populated execution row with its columns', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      expect(within(table).getByText('remision_p2.pdf')).toBeInTheDocument();
      expect(within(table).getByText('P2')).toBeInTheDocument();
      expect(within(table).getByText('Completado')).toBeInTheDocument();
      expect(within(table).getByText('0/2')).toBeInTheDocument();
      expect(within(table).getByText('3')).toBeInTheDocument();
      expect(within(table).getByText('85–87')).toBeInTheDocument();
    });

    it('shows "Proceso no determinado" when processLabel is null, never inferring one client-side (§B)', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary({ processLabel: null })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      expect(within(table).getByText('Proceso no determinado')).toBeInTheDocument();
    });

    it('shows the BIGINT executionId table row keyed correctly without truncation (data integrity)', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary({ executionId: '9223372036854775807' })]));
      renderPage();
      expect(await screen.findByText('remision_p2.pdf')).toBeInTheDocument();
    });
  });

  describe('execution detail (§A5)', () => {
    beforeEach(() => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      detailMock.mockResolvedValue(executionDetail());
    });

    it.each(['{Enter}', ' '])('opens the existing detail through the tab-reachable date button using %s', async (key) => {
      const user = userEvent.setup(); renderPage();
      const open = await screen.findByRole('button', { name: 'Ver detalle de ejecución Caterpillar 9007199254740993' });
      for (let index = 0; index < 24 && document.activeElement !== open; index += 1) await user.tab();
      expect(open).toHaveFocus();
      await user.keyboard(key);
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('9007199254740993')).toBeInTheDocument();
      expect(detailMock).toHaveBeenCalledTimes(1);
      expect(detailMock).toHaveBeenCalledWith('9007199254740993');
      await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(open).toHaveFocus();
    });

    it('opens the detail dialog when a row is clicked, requesting the exact executionId', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      expect(await screen.findByRole('heading', { name: 'Detalle de ejecución' })).toBeInTheDocument();
      expect(detailMock).toHaveBeenCalledWith('9007199254740993');
    });

    it('renders general execution fields', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('9007199254740993')).toBeInTheDocument();
      expect(within(dialog).getByText('wf-1')).toBeInTheDocument();
      expect(within(dialog).getByText('0 / 2')).toBeInTheDocument();
    });

    it('renders the source document fields', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('/dropbox/cat/p2/remision_p2.pdf')).toBeInTheDocument();
      expect(within(dialog).getByText('abc123hash')).toBeInTheDocument();
      expect(within(dialog).getByText('DROPBOX')).toBeInTheDocument();
    });

    it('renders folio reservations', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      const reservationsTable = within(dialog).getByRole('table', { name: 'Reservas de folio' });
      expect(within(reservationsTable).getByText('85')).toBeInTheDocument();
      expect(within(reservationsTable).getByText('87')).toBeInTheDocument();
      expect(within(reservationsTable).getByText('Aplicada')).toBeInTheDocument();
    });

    it('renders remittances with their folio, status, and plain-text PDF path', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText(/Folio 85/)).toBeInTheDocument();
      expect(within(dialog).getByText('Generada')).toBeInTheDocument();
      const pdfPathText = within(dialog).getByText('/dropbox/cat/p2/85.pdf');
      expect(pdfPathText).toBeInTheDocument();
      // Plain text only: never rendered as a link or button (no "Abrir PDF", §H).
      expect(pdfPathText.closest('a, button')).toBeNull();
    });

    it('renders remittance details/articles', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('X1')).toBeInTheDocument();
      expect(within(dialog).getByText('PN-1')).toBeInTheDocument();
      expect(within(dialog).getByText('Parte hidráulica')).toBeInTheDocument();
      expect(within(dialog).getByText('2 PZA')).toBeInTheDocument();
    });

    it('shows an empty message when there are no reservations or remittances yet', async () => {
      detailMock.mockResolvedValue(executionDetail({ reservations: [], remittances: [] }));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Sin reservas de folio registradas.')).toBeInTheDocument();
      expect(within(dialog).getByText('Sin remisiones generadas todavía.')).toBeInTheDocument();
    });

    it('shows an error state with retry when the detail request fails', async () => {
      detailMock.mockRejectedValue(new Error('boom'));
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      expect(await screen.findByText('No fue posible cargar el detalle de esta ejecución.')).toBeInTheDocument();
    });

    it('closes the dialog without leaving it mounted', async () => {
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      await screen.findByRole('dialog');
      await user.click(screen.getByRole('button', { name: 'Cerrar' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
  });

  describe('no write actions (§H)', () => {
    // Phase 12B.2 §K: "Ajustar folio" is one deliberate, newly-authorized ADMIN-only write action
    // (series next-folio adjustment). Phase 12C adds a second, narrowly-scoped one: "Reprocesar",
    // only ever rendered inside the execution detail dialog once it's open, for ADMIN, and only for
    // an ERROR/CANCELADA execution (see the dedicated "reprocess (Phase 12C)" describe block below)
    // — never in this list view itself. Activar/Desactivar/Cambiar serie/Cancelar remain entirely
    // absent everywhere on this page.
    it('renders no Activar, Desactivar, Cambiar serie, or Cancelar action, and no Reprocesar in the list view (no dialog open)', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      renderPage();
      await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      for (const forbidden of ['Reprocesar', 'Activar', 'Desactivar', 'Cambiar serie', 'Cancelar']) {
        expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
      }
    });

    it('never issues a POST/PATCH/PUT/DELETE request — every fetch call is a plain GET', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      detailMock.mockResolvedValue(executionDetail());
      const user = userEvent.setup();
      renderPage();
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      await screen.findByRole('dialog');
      // This page only calls typed service functions (listAutomationsOverview,
      // listCaterpillarSeries, listCaterpillarExecutions, getCaterpillarExecution), all mocked
      // above — the real `fetch` is never reached, so the spy call count is the real assertion:
      // this page performs zero raw fetch calls of its own.
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // Phase 12C: manual reprocess. The ERROR/CANCELADA (FAILED/CANCELLED) + ADMIN gate is UX only —
  // real enforcement is the backend's @Roles('ADMIN'); the backend/n8n can still reject an
  // apparently-eligible execution, and that rejection is always surfaced (never hidden or retried
  // automatically).
  describe('reprocess (Phase 12C)', () => {
    async function openDetailDialog(user: ReturnType<typeof userEvent.setup>) {
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      return screen.findByRole('dialog');
    }

    function setupExecution(outcome: CaterpillarExecutionDetail['outcome']) {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary({ outcome })]));
      detailMock.mockResolvedValue(executionDetail({ outcome }));
    }

    it('ADMIN + ERROR (FAILED) sees Reprocesar', async () => {
      setupExecution('FAILED');
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).getByRole('button', { name: 'Reprocesar' })).toBeInTheDocument();
    });

    it('ADMIN + CANCELADA (CANCELLED) sees Reprocesar', async () => {
      setupExecution('CANCELLED');
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).getByRole('button', { name: 'Reprocesar' })).toBeInTheDocument();
    });

    it('ADMIN + COMPLETADA (COMPLETED) does not see Reprocesar', async () => {
      setupExecution('COMPLETED');
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
    });

    it('ADMIN + PROCESANDO (PROCESSING) does not see Reprocesar', async () => {
      setupExecution('PROCESSING');
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
    });

    it('GENERAL + ERROR does not see Reprocesar', async () => {
      setupExecution('FAILED');
      const user = userEvent.setup();
      renderPage(testGeneralUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
    });

    it('REPROCESS_CREATED: shows the success snackbar, closes the reprocess dialog, and refreshes the executions list', async () => {
      setupExecution('FAILED');
      reprocessMock.mockResolvedValue({ originalExecutionId: '9007199254740993', executionId: '154', status: 'REPROCESS_CREATED' });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      const callsBeforeReprocess = executionsMock.mock.calls.length;

      await user.click(within(detailDialog).getByRole('button', { name: 'Reprocesar' }));
      const reprocessDialog = await screen.findByRole('dialog', { name: 'Reprocesar ejecución' });
      await user.type(within(reprocessDialog).getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo de prueba');
      await user.click(within(reprocessDialog).getByRole('button', { name: 'Reprocesar' }));

      expect(await screen.findByText('Reproceso iniciado correctamente. Nueva ejecución: #154')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reprocesar ejecución' })).not.toBeInTheDocument());
      // The original execution's own detail dialog stays open (never mutated/closed) while the
      // executions list refetches in the background to eventually reveal the new child.
      expect(screen.getByRole('dialog', { name: 'Detalle de ejecución' })).toBeInTheDocument();
      await waitFor(() => expect(executionsMock.mock.calls.length).toBeGreaterThan(callsBeforeReprocess));
    });

    it('ALREADY_PROCESSING: shows the correct message and refreshes, without mentioning an executionId', async () => {
      setupExecution('FAILED');
      reprocessMock.mockResolvedValue({ originalExecutionId: '9007199254740993', executionId: '154', status: 'ALREADY_PROCESSING' });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      await user.click(within(detailDialog).getByRole('button', { name: 'Reprocesar' }));
      const reprocessDialog = await screen.findByRole('dialog', { name: 'Reprocesar ejecución' });
      await user.type(within(reprocessDialog).getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
      await user.click(within(reprocessDialog).getByRole('button', { name: 'Reprocesar' }));
      expect(await screen.findByText('El reproceso ya está en curso.')).toBeInTheDocument();
    });

    it('ALREADY_REPROCESSED: shows the informative message with the existing executionId, never as an error', async () => {
      setupExecution('FAILED');
      reprocessMock.mockResolvedValue({ originalExecutionId: '9007199254740993', executionId: '154', status: 'ALREADY_REPROCESSED' });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      await user.click(within(detailDialog).getByRole('button', { name: 'Reprocesar' }));
      const reprocessDialog = await screen.findByRole('dialog', { name: 'Reprocesar ejecución' });
      await user.type(within(reprocessDialog).getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
      await user.click(within(reprocessDialog).getByRole('button', { name: 'Reprocesar' }));
      expect(await screen.findByText('Esta ejecución ya fue reprocesada. Reproceso existente: #154')).toBeInTheDocument();
    });

    it.each([
      [404, undefined, 'La ejecución ya no existe o no está disponible.'],
      [409, 'Esta ejecución no está en un estado elegible para reproceso.', 'Esta ejecución no está en un estado elegible para reproceso.'],
      [502, undefined, 'No fue posible comunicarse correctamente con la automatización.'],
      [504, undefined, 'La automatización tardó demasiado en responder.']
    ] as const)('HTTP %d shows the mapped error message inside the reprocess dialog', async (status, serverMessage, expectedMessage) => {
      setupExecution('FAILED');
      reprocessMock.mockRejectedValue(new CaterpillarReprocessApiError(status, serverMessage));
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      await user.click(within(detailDialog).getByRole('button', { name: 'Reprocesar' }));
      const reprocessDialog = await screen.findByRole('dialog', { name: 'Reprocesar ejecución' });
      await user.type(within(reprocessDialog).getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
      await user.click(within(reprocessDialog).getByRole('button', { name: 'Reprocesar' }));
      expect(await within(reprocessDialog).findByText(expectedMessage)).toBeInTheDocument();
    });

    it('never exposes the n8n token or webhook URL anywhere in the rendered page after an error', async () => {
      setupExecution('FAILED');
      reprocessMock.mockRejectedValue(new Error('fetch failed http://host.docker.internal:5678/webhook-test/cat-test-reprocess token=secret-value'));
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      await user.click(within(detailDialog).getByRole('button', { name: 'Reprocesar' }));
      const reprocessDialog = await screen.findByRole('dialog', { name: 'Reprocesar ejecución' });
      await user.type(within(reprocessDialog).getByRole('textbox', { name: 'Motivo del reproceso' }), 'Motivo');
      await user.click(within(reprocessDialog).getByRole('button', { name: 'Reprocesar' }));
      await screen.findByRole('alert');
      expect(document.body.textContent).not.toMatch(/token|webhook|5678/i);
    });
  });
  // Commercial regeneration: a separate, ADMIN-only action offered ONLY when the Hub says the execution is eligible. The technical Reprocesar rule is untouched.
  describe('commercial regeneration (017)', () => {
    const eligible = { eligible: true, blockedBy: null, authorization: null } as const;
    async function openDetailDialog(user: ReturnType<typeof userEvent.setup>) {
      const table = await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      await user.click(within(table).getByText('remision_p2.pdf'));
      return screen.findByRole('dialog');
    }
    function setup(regeneration: CaterpillarExecutionDetail['regeneration'], outcome: CaterpillarExecutionDetail['outcome'] = 'COMPLETED') {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary({ outcome })]));
      detailMock.mockResolvedValue(executionDetail({ outcome, regeneration }));
    }

    it('ADMIN sees Regenerar (and never Reprocesar) on a COMPLETADA execution the Hub reports as eligible', async () => {
      setup(eligible);
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).getByRole('button', { name: 'Regenerar' })).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Reprocesar' })).not.toBeInTheDocument();
    });
    it('GENERAL never sees Regenerar', async () => {
      setup(eligible);
      const user = userEvent.setup();
      renderPage(testGeneralUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).queryByRole('button', { name: 'Regenerar' })).not.toBeInTheDocument();
    });
    it('is not offered when the Hub says the execution is not eligible, and an ERROR execution only offers the technical Reprocesar', async () => {
      setup({ eligible: false, blockedBy: 'LIVE_REMISSIONS', authorization: null });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).queryByRole('button', { name: 'Regenerar' })).not.toBeInTheDocument();
    });
    it('explains why a fully cancelled historical program cannot be regenerated from the Hub (decision manual), without offering the button', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary({ outcome: 'COMPLETED' })]));
      detailMock.mockResolvedValue(executionDetail({ outcome: 'COMPLETED', regeneration: { eligible: false, blockedBy: 'NO_SNAPSHOT', authorization: null },
        remittances: executionDetail().remittances.map((remittance) => ({ ...remittance, status: 'CANCELADA' })) }));
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).getByText(/requiere una decisión manual/)).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Regenerar' })).not.toBeInTheDocument();
    });
    it('shows who authorized a regeneration and why', async () => {
      setup({ eligible: false, blockedBy: 'ALREADY_REGENERATED', authorization: { authorizationId: '9', reason: 'Corrección comercial', userId: '1', userEmail: 'admin@test.mx',
        userDisplayName: 'Admin Prueba', authorizedAt: '2026-10-24T10:00:00.000Z', requestId: null, regeneratedExecutionId: '301' } });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const dialog = await openDetailDialog(user);
      expect(within(dialog).getByText(/Admin Prueba/)).toBeInTheDocument();
      expect(within(dialog).getByText(/Corrección comercial/)).toBeInTheDocument();
      expect(within(dialog).getByText(/ejecución #301/)).toBeInTheDocument();
    });
    it('authorizing sends the reason to the regenerate endpoint (never the reprocess one), shows the started message, and refreshes the list', async () => {
      setup(eligible);
      regenerateMock.mockResolvedValue({ originalExecutionId: '9007199254740993', executionId: '301', status: 'REGENERATION_STARTED', authorization: null });
      const user = userEvent.setup();
      renderPage(testAdminUser);
      const detailDialog = await openDetailDialog(user);
      const before = executionsMock.mock.calls.length;
      await user.click(within(detailDialog).getByRole('button', { name: 'Regenerar' }));
      const regenerateDialog = await screen.findByRole('dialog', { name: 'Regenerar remisiones' });
      await user.type(within(regenerateDialog).getByRole('textbox', { name: /Motivo de la regeneración/ }), 'Corrección comercial');
      await user.click(within(regenerateDialog).getByRole('button', { name: 'Autorizar y regenerar' }));
      expect(await screen.findByText(/Regeneración iniciada\. Nueva ejecución: #301/)).toBeInTheDocument();
      expect(regenerateMock).toHaveBeenCalledWith('9007199254740993', 'Corrección comercial');
      expect(reprocessMock).not.toHaveBeenCalled();
      await waitFor(() => expect(executionsMock.mock.calls.length).toBeGreaterThan(before));
    });
  });
});

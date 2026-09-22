import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import {
  getCaterpillarExecution,
  listCaterpillarExecutions,
  listCaterpillarSeries,
  type CaterpillarExecutionDetail,
  type CaterpillarExecutionSummary,
  type CaterpillarProcessRoute,
  type ListCaterpillarExecutions
} from '../services/caterpillarRemissions';
import { CaterpillarRemissionsPage } from './CaterpillarRemissionsPage';

vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  listAutomationsOverview: vi.fn()
}));
vi.mock('../services/caterpillarRemissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/caterpillarRemissions')>()),
  listCaterpillarSeries: vi.fn(),
  listCaterpillarExecutions: vi.fn(),
  getCaterpillarExecution: vi.fn()
}));

const overviewMock = vi.mocked(listAutomationsOverview);
const seriesMock = vi.mocked(listCaterpillarSeries);
const executionsMock = vi.mocked(listCaterpillarExecutions);
const detailMock = vi.mocked(getCaterpillarExecution);

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

function renderPage() {
  return render(<MemoryRouter><CaterpillarRemissionsPage /></MemoryRouter>);
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

    it('renders Torreón and Torreón Planta 2 as two distinct rows despite sharing one series, never deduplicated', async () => {
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesos y series de Caterpillar' });
      expect(within(table).getByText('Torreón')).toBeInTheDocument();
      expect(within(table).getByText('Torreón Planta 2')).toBeInTheDocument();
      expect(within(table).getAllByText('REMISION_CAT_TORREON')).toHaveLength(2);
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
    it('renders no action buttons beyond pagination/retry/close — no Reprocesar, Activar, Desactivar, Editar folio, or Cancelar', async () => {
      executionsMock.mockResolvedValue(executionsResponse([executionSummary()]));
      renderPage();
      await screen.findByRole('table', { name: 'Ejecuciones recientes de Caterpillar' });
      for (const forbidden of ['Reprocesar', 'Activar', 'Desactivar', 'Editar próximo folio', 'Cambiar serie', 'Cancelar']) {
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
});

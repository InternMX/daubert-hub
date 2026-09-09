import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, getDocumentSeries, type AutomationSeriesConfiguration } from '../services/automations';
import { listAudiExecutions, type AudiProcessingSummary, type ListAudiExecutions } from '../services/audiExecutions';
import { listAutomationsOverview, type AutomationOverview } from '../services/automationsOverview';
import { AudiRemissionsPage } from './AudiRemissionsPage';

vi.mock('../services/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automations')>()),
  getDocumentSeries: vi.fn(),
  adjustDocumentSeries: vi.fn()
}));
vi.mock('../services/automationsOverview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automationsOverview')>()),
  listAutomationsOverview: vi.fn()
}));
vi.mock('../services/audiExecutions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/audiExecutions')>()),
  listAudiExecutions: vi.fn()
}));

const getMock = vi.mocked(getDocumentSeries);
const adjustMock = vi.mocked(adjustDocumentSeries);
const overviewMock = vi.mocked(listAutomationsOverview);
const executionsMock = vi.mocked(listAudiExecutions);

const configuration: AutomationSeriesConfiguration = {
  automation: { code: 'REMISIONES_AUDI', name: 'Remisiones Audi', status: 'ACTIVO' },
  series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 994, status: 'ACTIVO' },
  adjustments: [{ previousFolio: 995, newFolio: 994, reason: 'Ajuste anterior', userEmail: null, createdAt: '2026-08-27T12:00:00.000Z' }]
};

function audiOverview(overrides: Partial<AutomationOverview> = {}): AutomationOverview {
  return {
    code: 'REMISIONES_AUDI',
    name: 'Remisiones Audi',
    description: 'Generación y control de remisiones.',
    integrationStatus: 'INTEGRATED',
    environment: 'TEST',
    lifecycleStatus: 'ACTIVE',
    polling: { intervalMinutes: 10, label: 'Cada 10 minutos' },
    lastCheckAt: null,
    lastProcessing: { occurredAt: '2026-08-27T22:40:01.933Z', outcome: 'COMPLETED' },
    nextCheckAt: null,
    capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false },
    ...overrides
  };
}

function execution(overrides: Partial<AudiProcessingSummary> = {}): AudiProcessingSummary {
  return {
    occurredAt: '2026-08-27T22:40:01.933Z',
    outcome: 'COMPLETED',
    generatedCount: 5,
    firstFolio: '9000',
    lastFolio: '9004',
    ...overrides
  };
}

function executionsResponse(data: AudiProcessingSummary[], meta: Partial<ListAudiExecutions['meta']> = {}): ListAudiExecutions {
  return { data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1, ...meta } };
}

function renderPage() { return render(<MemoryRouter><AudiRemissionsPage /></MemoryRouter>); }
function displayedFolio() { return screen.getByText('Próxima remisión').previousElementSibling; }

describe('AudiRemissionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue(configuration);
    overviewMock.mockResolvedValue([audiOverview()]);
    executionsMock.mockResolvedValue(executionsResponse([execution()]));
  });

  describe('header and breadcrumb', () => {
    it('renders the page heading, breadcrumb, and operational description', async () => {
      renderPage();
      expect(await screen.findByRole('heading', { level: 1, name: 'Remisiones Audi' })).toBeInTheDocument();
      expect(screen.getByText('Generación y control automático de remisiones.')).toBeInTheDocument();
      const breadcrumb = screen.getByRole('navigation', { name: 'Migas de pan' });
      expect(within(breadcrumb).getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
      expect(within(breadcrumb).getByRole('link', { name: 'Automatizaciones' })).toHaveAttribute('href', '/automations');
    });
  });

  describe('Estado operacional', () => {
    function statusSection() {
      return screen.getByRole('heading', { level: 2, name: 'Estado operacional' }).closest('section') as HTMLElement;
    }

    it('shows the Activa lifecycle chip, frequency, latest processing, and result', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Estado operacional' });
      const section = within(statusSection());
      // Wait for the section's own async fetch to resolve before making synchronous assertions —
      // the h2 renders immediately, independent of OperationalStatusSection's own loading state.
      expect(await section.findByText('Completado')).toBeInTheDocument();
      expect(section.getByText('Activa')).toBeInTheDocument();
      expect(section.getByText('Cada 10 minutos')).toBeInTheDocument();
    });

    it('shows Inactiva when the automation lifecycle is INACTIVE', async () => {
      overviewMock.mockResolvedValue([audiOverview({ lifecycleStatus: 'INACTIVE' })]);
      renderPage();
      expect(await screen.findByText('Inactiva')).toBeInTheDocument();
    });

    it('never shows Última revisión or Próxima revisión (no-work polling cycles are not persisted)', async () => {
      renderPage();
      await screen.findByRole('heading', { level: 2, name: 'Estado operacional' });
      await within(statusSection()).findByText('Completado');
      expect(screen.queryByText('Última revisión')).not.toBeInTheDocument();
      expect(screen.queryByText('Próxima revisión summary')).not.toBeInTheDocument();
    });

    it('shows a section-scoped error with retry on failure, without destroying the rest of the page', async () => {
      overviewMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar el estado operacional.')).toBeInTheDocument();
      expect(displayedFolio()).toHaveTextContent('994');
      expect(screen.getByRole('table', { name: 'Historial de ajustes' })).toBeInTheDocument();
    });
  });

  describe('Serie documental', () => {
    it('renders the current next folio, adjustment history, and preserves the edit action', async () => {
      renderPage();
      expect(await screen.findByRole('heading', { level: 2, name: 'Serie documental' })).toBeInTheDocument();
      expect(displayedFolio()).toHaveTextContent('994');
      expect(screen.getByRole('button', { name: 'Editar próximo folio' })).toBeInTheDocument();
      const history = screen.getByRole('table', { name: 'Historial de ajustes' });
      expect(within(history).getByText('Ajuste anterior')).toBeInTheDocument();
      expect(within(history).getByText('—')).toBeInTheDocument();
    });

    it('shows the empty adjustment-history state', async () => {
      getMock.mockResolvedValue({ ...configuration, adjustments: [] });
      renderPage();
      expect(await screen.findByText('Aún no hay ajustes manuales.')).toBeInTheDocument();
    });

    it('opens the dialog with a read-only current folio and requires a reason', async () => {
      const user = userEvent.setup(); renderPage();
      await user.click(await screen.findByRole('button', { name: 'Editar próximo folio' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('textbox', { name: 'Próximo folio actual' })).toHaveAttribute('readonly');
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo próximo folio' }), { target: { value: '1000' } });
      await user.click(within(dialog).getByRole('button', { name: 'Guardar ajuste' }));
      expect(within(dialog).getByText('El motivo es obligatorio.')).toBeInTheDocument();
      expect(adjustMock).not.toHaveBeenCalled();
    });

    it('warns for a lower folio but still submits it', async () => {
      const user = userEvent.setup(); renderPage();
      await user.click(await screen.findByRole('button', { name: 'Editar próximo folio' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo próximo folio' }), { target: { value: '993' } });
      expect(within(dialog).getByText(/Estás estableciendo un folio menor/)).toBeInTheDocument();
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: ' Remisión incorrecta ' } });
      adjustMock.mockResolvedValue({ ...configuration, series: { ...configuration.series, nextFolio: 993 }, adjustments: [{ previousFolio: 994, newFolio: 993, reason: 'Remisión incorrecta', userEmail: null, createdAt: '2026-08-27T13:00:00.000Z' }, ...configuration.adjustments] });
      await user.click(within(dialog).getByRole('button', { name: 'Guardar ajuste' }));
      await waitFor(() => expect(adjustMock).toHaveBeenCalledWith('REMISIONES_AUDI', 'REMISION_AUDI', { nextFolio: 993, reason: 'Remisión incorrecta' }));
    });

    it('closes the dialog and refreshes the displayed folio and history after saving', async () => {
      const user = userEvent.setup();
      adjustMock.mockResolvedValue({ ...configuration, series: { ...configuration.series, nextFolio: 1000 }, adjustments: [{ previousFolio: 994, newFolio: 1000, reason: 'Salto autorizado', userEmail: 'admin@example.test', createdAt: '2026-08-27T13:00:00.000Z' }, ...configuration.adjustments] });
      renderPage(); await user.click(await screen.findByRole('button', { name: 'Editar próximo folio' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Nuevo próximo folio' }), { target: { value: '1000' } });
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Salto autorizado' } });
      await user.click(within(dialog).getByRole('button', { name: 'Guardar ajuste' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(displayedFolio()).toHaveTextContent('1000');
      expect(screen.getByText('Salto autorizado')).toBeInTheDocument();
      expect(screen.getByText('El próximo folio se actualizó correctamente.')).toBeInTheDocument();
    });
  });

  describe('Procesamientos recientes', () => {
    it.each([
      ['COMPLETED', 'Completado'],
      ['FAILED', 'Fallido'],
      ['PROCESSING', 'En proceso'],
      ['CANCELLED', 'Cancelado']
    ] as const)('translates outcome %s to %s', async (outcome, label) => {
      executionsMock.mockResolvedValue(executionsResponse([execution({ outcome })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesamientos recientes' });
      expect(within(table).getByText(label)).toBeInTheDocument();
    });

    it('renders the generated remissions count', async () => {
      executionsMock.mockResolvedValue(executionsResponse([execution({ generatedCount: 5 })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesamientos recientes' });
      expect(within(table).getByText('5')).toBeInTheDocument();
    });

    it('renders a single generated folio as one value, not a range', async () => {
      executionsMock.mockResolvedValue(executionsResponse([execution({ generatedCount: 1, firstFolio: '9005', lastFolio: '9005' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesamientos recientes' });
      expect(within(table).getByText('9005')).toBeInTheDocument();
      expect(within(table).queryByText('9005–9005')).not.toBeInTheDocument();
    });

    it('renders a folio range with an en dash', async () => {
      executionsMock.mockResolvedValue(executionsResponse([execution({ generatedCount: 5, firstFolio: '9000', lastFolio: '9004' })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesamientos recientes' });
      expect(within(table).getByText('9000–9004')).toBeInTheDocument();
    });

    it('renders a dash when no folio was generated, never a fabricated range', async () => {
      executionsMock.mockResolvedValue(executionsResponse([execution({ generatedCount: 0, firstFolio: null, lastFolio: null })]));
      renderPage();
      const table = await screen.findByRole('table', { name: 'Procesamientos recientes' });
      expect(within(table).getByText('—')).toBeInTheDocument();
    });

    it('shows the empty state when there is no processing history, without hiding the rest of the page', async () => {
      executionsMock.mockResolvedValue(executionsResponse([], { total: 0, totalPages: 0 }));
      renderPage();
      expect(await screen.findByText('Aún no hay procesamientos registrados.')).toBeInTheDocument();
      expect(displayedFolio()).toHaveTextContent('994');
      expect(screen.getByRole('table', { name: 'Historial de ajustes' })).toBeInTheDocument();
    });

    it('shows a section-scoped error with retry on failure, without destroying the rest of the page', async () => {
      executionsMock.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('No fue posible cargar los procesamientos recientes.')).toBeInTheDocument();
      expect(displayedFolio()).toHaveTextContent('994');
      expect(await screen.findByText('Activa')).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Historial de ajustes' })).toBeInTheDocument();
    });

    it('requests a new page from the server on pagination, never slicing client-side', async () => {
      executionsMock.mockResolvedValue(executionsResponse([execution()], { page: 1, pageSize: 25, total: 60, totalPages: 3 }));
      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('table', { name: 'Procesamientos recientes' });
      await user.click(screen.getByRole('button', { name: 'Siguiente' }));
      await waitFor(() => expect(executionsMock).toHaveBeenCalledWith(2, 25));
    });
  });
});

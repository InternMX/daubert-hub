import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAutomationsOverview } from '../services/automationsOverview';
import { AutomationsPage } from './AutomationsPage';

vi.mock('../services/automationsOverview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/automationsOverview')>()), listAutomationsOverview: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('Automatizaciones · Hojas de manufactura como proceso asistido', () => {
  it('aparece como tarjeta de «Proceso asistido» con acceso directo al gestor, sin horario, ejecuciones ni estado de procesamiento inventados', async () => {
    vi.mocked(listAutomationsOverview).mockResolvedValue([{
      code: 'REMISIONES_AUDI', name: 'Remisiones Audi', description: 'Remisiones.', integrationStatus: 'INTEGRATED', environment: 'TEST', lifecycleStatus: 'ACTIVE', polling: { intervalMinutes: 10, label: 'Cada 10 minutos' },
      lastCheckAt: null, lastProcessing: null, nextCheckAt: null, capabilities: { hasDashboard: true, hasHistory: true, hasDetail: false }, review: { required: false, problemOccurredAt: null, problemOutcome: null }
    }]);
    render(<MemoryRouter><AutomationsPage /></MemoryRouter>);
    const tarjeta = await screen.findByTestId('assisted-process-card');
    expect(within(tarjeta).getByRole('heading', { name: 'Hojas de manufactura' })).toBeInTheDocument();
    expect(within(tarjeta).getByText('Proceso asistido')).toBeInTheDocument();
    expect(within(tarjeta).getByRole('link', { name: 'Abrir gestor' })).toHaveAttribute('href', '/automations/manufacturing-sheets');
    expect(within(tarjeta).queryByText(/Frecuencia|Próxima revisión|Última revisión|Último procesamiento|Resultado|Cada \d+ minutos/)).toBeNull();
    expect(within(tarjeta).queryByText(/n8n|Activa/)).toBeNull();
    expect(screen.getByTestId('automations-grid')).toContainElement(tarjeta);                      // mismo grid que las automatizaciones reales
    expect(screen.getByRole('heading', { name: 'Remisiones Audi' })).toBeInTheDocument();           // las demás no cambian
  });

  it('sigue disponible aunque no haya automatizaciones de n8n en el catálogo; si falla la carga no se muestra', async () => {
    vi.mocked(listAutomationsOverview).mockResolvedValue([]);
    const a = render(<MemoryRouter><AutomationsPage /></MemoryRouter>);
    expect(await screen.findByTestId('assisted-process-card')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay automatizaciones registradas.')).toBeInTheDocument();
    a.unmount();
    vi.mocked(listAutomationsOverview).mockRejectedValue(new Error('x'));
    render(<MemoryRouter><AutomationsPage /></MemoryRouter>);
    expect(await screen.findByText(/No fue posible cargar las automatizaciones/)).toBeInTheDocument();
    expect(screen.queryByTestId('assisted-process-card')).toBeNull();
  });
});

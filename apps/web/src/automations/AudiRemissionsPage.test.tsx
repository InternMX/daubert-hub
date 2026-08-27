import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, getDocumentSeries, type AutomationSeriesConfiguration } from '../services/automations';
import { AudiRemissionsPage } from './AudiRemissionsPage';

vi.mock('../services/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automations')>()),
  getDocumentSeries: vi.fn(),
  adjustDocumentSeries: vi.fn()
}));

const getMock = vi.mocked(getDocumentSeries);
const adjustMock = vi.mocked(adjustDocumentSeries);
const configuration: AutomationSeriesConfiguration = {
  automation: { code: 'REMISIONES_AUDI', name: 'Remisiones Audi', status: 'ACTIVO' },
  series: { code: 'REMISION_AUDI', name: 'Remisión Audi', nextFolio: 994, status: 'ACTIVO' },
  adjustments: [{ previousFolio: 995, newFolio: 994, reason: 'Ajuste anterior', userEmail: null, createdAt: '2026-08-27T12:00:00.000Z' }]
};

function renderPage() { return render(<MemoryRouter><AudiRemissionsPage /></MemoryRouter>); }
function displayedFolio() { return screen.getByText('Próxima remisión').previousElementSibling; }

describe('AudiRemissionsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); getMock.mockResolvedValue(configuration); });

  it('renders the current next folio and adjustment history with an absent-user fallback', async () => {
    renderPage();
    expect(await screen.findByText('Automatización activa')).toBeInTheDocument();
    expect(displayedFolio()).toHaveTextContent('994');
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

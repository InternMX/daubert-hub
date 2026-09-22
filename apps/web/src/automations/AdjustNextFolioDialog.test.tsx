import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustDocumentSeries, AutomationApiError, type AutomationSeriesConfiguration } from '../services/automations';
import { AdjustNextFolioDialog } from './AdjustNextFolioDialog';

vi.mock('../services/automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/automations')>()),
  adjustDocumentSeries: vi.fn()
}));

const adjustMock = vi.mocked(adjustDocumentSeries);

const updatedConfiguration: AutomationSeriesConfiguration = {
  automation: { code: 'REMISIONES_CATERPILLAR', name: 'Remisiones Caterpillar', status: 'ACTIVA' },
  series: { code: 'REMISION_CAT_P5', name: 'Remision Caterpillar Planta 5', nextFolio: 130, status: 'ACTIVA' },
  adjustments: []
};

function renderDialog(overrides: { currentFolio?: number } = {}) {
  const onClose = vi.fn();
  const onAdjusted = vi.fn();
  render(
    <AdjustNextFolioDialog
      open
      automationCode="REMISIONES_CATERPILLAR"
      seriesCode="REMISION_CAT_P5"
      seriesLabel="REMISION_CAT_P5"
      currentFolio={overrides.currentFolio ?? 124}
      onClose={onClose}
      onAdjusted={onAdjusted}
    />
  );
  return { onClose, onAdjusted };
}

describe('AdjustNextFolioDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the title, series, and current folio', () => {
    renderDialog();
    expect(screen.getByText('Ajustar siguiente folio')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Serie' })).toHaveValue('REMISION_CAT_P5');
    expect(screen.getByRole('textbox', { name: 'Folio actual' })).toHaveValue('124');
  });

  it('does not render the backward warning for a forward value', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    expect(screen.queryByText('Corrección excepcional hacia atrás')).not.toBeInTheDocument();
  });

  it('renders the exact backward warning wording, reused range, and mandatory checkbox for a backward value', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '119' } });
    expect(screen.getByText('Corrección excepcional hacia atrás')).toBeInTheDocument();
    expect(screen.getByText('Estás cambiando el siguiente folio de 124 a 119.')).toBeInTheDocument();
    expect(screen.getByText(/Antes de generar nuevas remisiones con estos folios, revisa la carpeta de salida correspondiente/)).toBeInTheDocument();
    expect(screen.getByText(/Si existe un PDF con el mismo nombre que una nueva remisión, la generación del PDF puede fallar\./)).toBeInTheDocument();
    expect(screen.getByText('Daubert Hub no eliminará ni modificará archivos automáticamente.')).toBeInTheDocument();
    expect(screen.getByText('Folios potencialmente reutilizados: 119–123')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Confirmo que revisé los archivos de salida correspondientes a los folios que se reutilizarán y que no provocarán conflicto con la nueva generación.' })).toBeInTheDocument();
  });

  it('keeps Guardar disabled for a backward value until the checkbox is checked', async () => {
    const user = userEvent.setup();
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '119' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    expect(screen.getByRole('button', { name: 'Guardar ajuste' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Confirmo que revisé/ }));
    expect(screen.getByRole('button', { name: 'Guardar ajuste' })).not.toBeDisabled();
  });

  it('sends backwardFilesystemAcknowledged: true only for a backward request', async () => {
    const user = userEvent.setup();
    adjustMock.mockResolvedValue(updatedConfiguration);
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '119' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await user.click(screen.getByRole('checkbox', { name: /Confirmo que revisé/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    await waitFor(() => expect(adjustMock).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', { expectedCurrentFolio: 124, nextFolio: 119, reason: 'Corrección', backwardFilesystemAcknowledged: true }));
  });

  it('never sends backwardFilesystemAcknowledged for a forward request', async () => {
    const user = userEvent.setup();
    adjustMock.mockResolvedValue(updatedConfiguration);
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    await waitFor(() => expect(adjustMock).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', { expectedCurrentFolio: 124, nextFolio: 130, reason: 'Corrección' }));
  });

  it('always sends expectedCurrentFolio bound to the currentFolio prop', async () => {
    const user = userEvent.setup();
    adjustMock.mockResolvedValue(updatedConfiguration);
    renderDialog({ currentFolio: 7 });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '9' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    await waitFor(() => expect(adjustMock).toHaveBeenCalledWith('REMISIONES_CATERPILLAR', 'REMISION_CAT_P5', { expectedCurrentFolio: 7, nextFolio: 9, reason: 'Corrección' }));
  });

  it('calls onAdjusted with the server response and onClose on success', async () => {
    const user = userEvent.setup();
    adjustMock.mockResolvedValue(updatedConfiguration);
    const { onClose, onAdjusted } = renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledWith(updatedConfiguration));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the backend-sanitized serverMessage on failure and keeps the dialog open', async () => {
    const user = userEvent.setup();
    adjustMock.mockRejectedValue(new AutomationApiError(409, 'SERIES_FOLIO_STALE', 'El folio actual cambió desde que se cargó esta pantalla. Actualiza la información e intenta de nuevo.'));
    const { onClose, onAdjusted } = renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await user.click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    expect(await screen.findByText('El folio actual cambió desde que se cargó esta pantalla. Actualiza la información e intenta de nuevo.')).toBeInTheDocument();
    expect(onAdjusted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to a generic Spanish message when the server sends no message, never exposing internal details', async () => {
    adjustMock.mockRejectedValue(new AutomationApiError(500, undefined, undefined));
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar ajuste' }));
    expect(await screen.findByText('No fue posible guardar el ajuste. Verifica los datos e intenta nuevamente.')).toBeInTheDocument();
  });

  it('rejects a folio equal to the current value (unchanged, not a valid adjustment)', () => {
    renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '124' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
    expect(screen.getByRole('button', { name: 'Guardar ajuste' })).toBeDisabled();
  });

  it('rejects 0 and negative folios', () => {
    renderDialog();
    for (const value of ['0', '-1']) {
      fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Corrección' } });
      expect(screen.getByRole('button', { name: 'Guardar ajuste' })).toBeDisabled();
    }
  });

  it('Cancelar closes without calling the API', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nuevo siguiente folio' }), { target: { value: '130' } });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(adjustMock).not.toHaveBeenCalled();
  });
});

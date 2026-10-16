import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewManufacturingSheet, SheetPreviewError, type SheetPreviewResponse } from '../services/sheetPreview';
import { PREVIEW_DEBOUNCE_MS, SheetPreviewPanel } from './SheetPreviewPanel';

vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn() }));
const previewMock = vi.mocked(previewManufacturingSheet);

const response = (html: string, over: Partial<SheetPreviewResponse> = {}): SheetPreviewResponse => ({
  html, familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], ...over
});
const DATA = { codigo: 'SCHFPMG001', ancho: '13', largo: '16' };
const wait = (ms = PREVIEW_DEBOUNCE_MS + 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('SheetPreviewPanel', () => {
  it('sin familia no consulta nada y pide seleccionarla; siempre se identifica como borrador', () => {
    render(<SheetPreviewPanel family={null} data={DATA} />);
    expect(screen.getByText(/Selecciona la familia/)).toBeInTheDocument();
    expect(screen.getAllByText('BORRADOR · SIN APROBAR').length).toBeGreaterThan(0);
    expect(screen.getByText('Firmas: SIN FIRMA')).toBeInTheDocument();
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('muestra el HTML de la plantilla en un iframe aislado (sandbox vacío, sin scripts) con marca de agua de borrador', async () => {
    previewMock.mockResolvedValue(response('<html><body><p id="sheet">HOJA SCHFPMG001</p></body></html>'));
    render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait();
    const frame = await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('HOJA SCHFPMG001');
    expect(frame).not.toHaveAttribute('src');
    expect(screen.getByTestId('draft-watermark')).toHaveTextContent('BORRADOR · SIN APROBAR');
    expect(previewMock).toHaveBeenCalledWith('BOLSA_PLANA_1', DATA, expect.any(AbortSignal));
  });

  it('aplica debounce: varios cambios seguidos generan una sola consulta con los últimos datos', async () => {
    previewMock.mockResolvedValue(response('<p>ok</p>'));
    const { rerender } = render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait(100);
    rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" data={{ ...DATA, ancho: '14' }} />);
    await wait(100);
    rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" data={{ ...DATA, ancho: '14.5' }} />);
    await wait();
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock.mock.calls[0]![1]).toEqual({ ...DATA, ancho: '14.5' });
  });

  it('evita condiciones de carrera: una respuesta antigua que llega tarde no reemplaza a la más reciente', async () => {
    let resolverViejo: (r: SheetPreviewResponse) => void = () => undefined;
    previewMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolverViejo = resolve; }))
      .mockResolvedValueOnce(response('<p>NUEVA ancho 14</p>'));
    const { rerender } = render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait();
    rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" data={{ ...DATA, ancho: '14' }} />);
    await wait();
    expect((await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1')).getAttribute('srcdoc')).toContain('NUEVA ancho 14');
    await act(async () => { resolverViejo(response('<p>VIEJA ancho 13</p>')); await Promise.resolve(); });
    expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('NUEVA ancho 14');
    expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).not.toContain('VIEJA');
  });

  it('cambiar de familia cancela la consulta anterior y usa la plantilla de la nueva', async () => {
    previewMock.mockImplementation(async (family) => response(`<p>PLANTILLA ${family}</p>`, { familia: family }));
    const { rerender } = render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait();
    rerender(<SheetPreviewPanel family="HOJA_PAQ" data={DATA} />);
    await wait();
    expect((await screen.findByTitle('Vista previa de la hoja Hoja Paq')).getAttribute('srcdoc')).toContain('PLANTILLA HOJA_PAQ');
  });

  it('muestra los datos faltantes y las advertencias del backend sin inventar nada', async () => {
    previewMock.mockResolvedValue(response('<p>x</p>', { completo: false, faltantes: ['Composición', 'Color del dibujo'], advertencias: ['El peso no es un número válido y no se muestra.'] }));
    render(<SheetPreviewPanel family="HOJA_PAQ" data={{ codigo: 'X' }} />);
    await wait();
    const avisos = await screen.findByLabelText('Advertencias de la vista previa');
    expect(within(avisos).getByText(/Faltan datos obligatorios.*Composición, Color del dibujo/)).toBeInTheDocument();
    expect(within(avisos).getByText('El peso no es un número válido y no se muestra.')).toBeInTheDocument();
  });

  it('errores: datos no válidos y servidor no disponible', async () => {
    previewMock.mockRejectedValueOnce(new SheetPreviewError('INVALID_DATA', 400));
    const { rerender } = render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait();
    expect(await screen.findByText(/Algún dato del formulario no es válido/)).toBeInTheDocument();
    previewMock.mockRejectedValueOnce(new SheetPreviewError('UNAVAILABLE', 500));
    rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" data={{ ...DATA, ancho: '15' }} />);
    await wait();
    expect(await screen.findByText('No se pudo generar la vista previa en este momento.')).toBeInTheDocument();
  });

  it('permite ampliar para ver la hoja completa en un iframe aislado, manteniendo la marca de borrador y la proporción carta', async () => {
    previewMock.mockResolvedValue(response('<p>HOJA COMPLETA</p>'));
    render(<SheetPreviewPanel family="BOLSA_PLANA_1" data={DATA} />);
    await wait();
    await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Ampliar' }));
    const dialog = await screen.findByRole('dialog');
    const frame = within(dialog).getByTitle('Hoja completa Bolsa Plana 1');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('HOJA COMPLETA');
    expect(within(dialog).getAllByText('BORRADOR · SIN APROBAR').length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getByTestId('draft-watermark')).toBeInTheDocument();
    const style = frame.getAttribute('style') ?? '';
    expect(style).toContain('width: 817px');
    expect(style).toContain('height: 1120px');
  });
});

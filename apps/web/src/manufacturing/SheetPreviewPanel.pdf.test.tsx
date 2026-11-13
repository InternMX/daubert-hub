import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDraftPdf, previewManufacturingSheet, SheetPdfError, type SheetPreviewResponse } from '../services/sheetPreview';
import { PREVIEW_DEBOUNCE_MS, SheetPreviewPanel } from './SheetPreviewPanel';

vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn(), downloadDraftPdf: vi.fn() }));
const previewMock = vi.mocked(previewManufacturingSheet);
const pdfMock = vi.mocked(downloadDraftPdf);

const response = (over: Partial<SheetPreviewResponse> = {}): SheetPreviewResponse => ({
  html: '<html><body><p>HOJA</p></body></html>', familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: null, ...over
});
const pdf = (over: Partial<{ filename: string; completo: boolean }> = {}) => ({ blob: new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), filename: 'BORRADOR_SCHFPMG001_BOLSA_PLANA_1.pdf', completo: true, ...over });
const DATA = { codigo: 'SCHFPMG001', ancho: '13', largo: '16' };
const CONTEXTO = { title: 'BOLSA VCI PMG 13 x 16"', code: 'SCHFPMG001' };
const espera = (ms = PREVIEW_DEBOUNCE_MS + 10) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const boton = () => screen.getByRole('button', { name: /Descargar PDF de borrador|Generando PDF/ });

let clic: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  URL.createObjectURL = vi.fn(() => 'blob:simulado'); URL.revokeObjectURL = vi.fn();
  clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks(); });

async function montar(props: Partial<Parameters<typeof SheetPreviewPanel>[0]> = {}, respuesta: SheetPreviewResponse = response()) {
  previewMock.mockResolvedValue(respuesta);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
  const vista = render(<SheetPreviewPanel family="BOLSA_PLANA_1" familyLabel="Bolsa Plana 1" data={DATA} context={CONTEXTO} {...props} />);
  await espera();
  return { user, vista };
}

describe('SheetPreviewPanel · Descargar PDF de borrador', () => {
  it('sin familia no hay acción de PDF; con familia está junto a la vista previa, deshabilitada hasta que la revisión de los datos actuales llega', async () => {
    const { vista } = await montar({ family: null });
    expect(screen.queryByRole('button', { name: /PDF/ })).not.toBeInTheDocument();
    vista.unmount();
    previewMock.mockImplementation(() => new Promise(() => undefined));
    render(<SheetPreviewPanel family="BOLSA_PLANA_1" familyLabel="Bolsa Plana 1" data={DATA} context={CONTEXTO} />);
    await espera();
    expect(boton()).toBeDisabled();
    expect(screen.getByText('Esperando la revisión de los datos actuales…')).toBeInTheDocument();
  });

  it('descarga el PDF del mismo documento (mismos datos y contexto que la vista previa), con nombre automático y confirma el éxito real', async () => {
    pdfMock.mockResolvedValue(pdf());
    const { user } = await montar();
    expect(boton()).toBeEnabled();
    expect(screen.getByText(/mismo documento de la vista previa/)).toBeInTheDocument();
    await user.click(boton());
    expect(pdfMock).toHaveBeenCalledTimes(1);
    expect(pdfMock).toHaveBeenCalledWith('BOLSA_PLANA_1', DATA, expect.any(AbortSignal), CONTEXTO);
    expect(previewMock).toHaveBeenLastCalledWith('BOLSA_PLANA_1', DATA, expect.any(AbortSignal), CONTEXTO);   // idénticos
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clic).toHaveBeenCalledTimes(1);
    expect(clic.mock.contexts[0]).toMatchObject({ download: 'BORRADOR_SCHFPMG001_BOLSA_PLANA_1.pdf' });
    expect(await screen.findByTestId('pdf-listo')).toHaveTextContent('BORRADOR_SCHFPMG001_BOLSA_PLANA_1.pdf');
  });

  it('pulsaciones repetidas no duplican la descarga: una sola generación a la vez y el botón muestra «Generando PDF…»', async () => {
    let resolver: (p: ReturnType<typeof pdf>) => void = () => undefined;
    pdfMock.mockImplementation(() => new Promise((resolve) => { resolver = resolve; }));
    const { user } = await montar();
    await user.click(boton());
    expect(boton()).toHaveTextContent('Generando PDF…');
    expect(boton()).toBeDisabled();
    fireEvent.click(boton()); fireEvent.click(boton());                                // un botón deshabilitado no genera otra solicitud
    expect(pdfMock).toHaveBeenCalledTimes(1);
    await act(async () => { resolver(pdf()); await Promise.resolve(); });
    expect(clic).toHaveBeenCalledTimes(1);
    expect(boton()).toHaveTextContent('Descargar PDF de borrador');
  });

  it('un documento bloqueado, o contradicciones sin reconocer, impiden pedir el PDF y lo explican', async () => {
    await montar({}, response({ bloqueado: 'La modalidad Extendida de Rollo Continuo no está autorizada.' }));
    expect(boton()).toBeDisabled();
    expect(screen.getByText('El documento está bloqueado: no se genera un PDF.')).toBeInTheDocument();
    expect(pdfMock).not.toHaveBeenCalled();
  });
  it('con contradicciones técnicas sin reconocer el PDF no se ofrece hasta corregirlas o reconocerlas', async () => {
    const { vista } = await montar({ pdfBloqueo: 'Corrige o reconoce las contradicciones técnicas (2) para descargar el PDF.' });
    expect(boton()).toBeDisabled();
    expect(screen.getByText(/Corrige o reconoce las contradicciones técnicas \(2\)/)).toBeInTheDocument();
    vista.rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" familyLabel="Bolsa Plana 1" data={DATA} context={CONTEXTO} pdfBloqueo={null} />);
    expect(boton()).toBeEnabled();
  });

  it('datos incompletos: se permite exportar para revisión, pero se anuncia y se confirma como INCOMPLETO', async () => {
    pdfMock.mockResolvedValue(pdf({ filename: 'BORRADOR-INCOMPLETO_SCHFPMG001_BOLSA_PLANA_1.pdf', completo: false }));
    const { user } = await montar({}, response({ completo: false, faltantes: ['Peso'] }));
    expect(screen.getByText(/saldrá marcado «BORRADOR INCOMPLETO»/)).toBeInTheDocument();
    await user.click(boton());
    expect(await screen.findByTestId('pdf-listo')).toHaveTextContent(/INCOMPLETO/);
  });

  it('un fallo real se informa con un mensaje comprensible, no pierde el formulario y permite reintentar (salvo si el entorno no lo ofrece)', async () => {
    pdfMock.mockRejectedValueOnce(new SheetPdfError('BUSY', 429)).mockResolvedValueOnce(pdf());
    const { user } = await montar();
    await user.click(boton());
    expect(await screen.findByTestId('pdf-error')).toHaveTextContent('Hay varios PDF en proceso');
    expect(clic).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-listo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByTestId('pdf-listo')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-error')).not.toBeInTheDocument();
  });
  it('sin renderizador en el entorno (501) se explica y no ofrece reintentar; el motivo del bloqueo del servidor se muestra tal cual', async () => {
    pdfMock.mockRejectedValueOnce(new SheetPdfError('NOT_AVAILABLE', 501)).mockRejectedValueOnce(new SheetPdfError('BLOCKED', 422, 'La modalidad Extendida no está autorizada.'));
    const { user } = await montar();
    await user.click(boton());
    expect(await screen.findByTestId('pdf-error')).toHaveTextContent('La generación de PDF no está disponible en este entorno');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    await user.click(boton());
    expect(await screen.findByText('La modalidad Extendida no está autorizada.')).toBeInTheDocument();
  });

  it('si los datos cambian mientras se genera, ese PDF se cancela y nunca se entrega (no usa una versión anterior)', async () => {
    let resolver: (p: ReturnType<typeof pdf>) => void = () => undefined;
    let senal: AbortSignal | undefined;
    pdfMock.mockImplementation((_f, _d, signal) => { senal = signal; return new Promise((resolve) => { resolver = resolve; }); });
    const { user, vista } = await montar();
    await user.click(boton());
    vista.rerender(<SheetPreviewPanel family="BOLSA_PLANA_1" familyLabel="Bolsa Plana 1" data={{ ...DATA, ancho: '14' }} context={CONTEXTO} />);
    expect(senal?.aborted).toBe(true);
    await act(async () => { resolver(pdf()); await Promise.resolve(); });
    expect(clic).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pdf-listo')).not.toBeInTheDocument();
    await espera();
    expect(boton()).toBeEnabled();                                                                            // la nueva versión se puede exportar
  });
});

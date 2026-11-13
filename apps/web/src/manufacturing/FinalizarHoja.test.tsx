import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as docs from '../services/manufacturingDocuments';
import type { DocumentoVista } from '../services/manufacturingDocuments';
import { BarraDocumento, DocumentoProvider, FinalizarHojaDocumento, ResponsablesDocumento, type BloqueoFinal, type EstadoDatos } from './DocumentPanel';
import { useDocumento } from './documentoContexto';
import type { CargaDocumento } from './documentSpec';

// Sección «Finalizar hoja» a nivel de componente: orden de acciones, bloqueos con navegación, guardado previo, comprobación del servidor, descarte con confirmación y revisión humana opcional.
vi.mock('../services/manufacturingDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/manufacturingDocuments')>()),
  obtenerDocumento: vi.fn(), actualizarBorrador: vi.fn(), finalizarDocumento: vi.fn(), descartarBorrador: vi.fn(), registrarRevision: vi.fn(), listarRevisores: vi.fn(), listarAbiertos: vi.fn(), historialPorCodigo: vi.fn()
}));
const m = vi.mocked(docs);

const PERMISOS = { editar: true, finalizar: true, asignarRevisor: true, registrarRevision: true, crearRevisionNueva: false, descargarPdf: false };
const DATOS = { codigo: 'DOC001', ancho: '13' };
const CARGA: CargaDocumento = { familia: 'BOLSA_PLANA_1', datos: DATOS, procedencia: {}, incidenciasReconocidas: [] };
const vista = (over: Partial<DocumentoVista> = {}): DocumentoVista => ({
  id: 'rev-1', documentoId: 'doc-1', codigo: 'DOC001', variante: null, familia: 'BOLSA_PLANA_1', estado: 'BORRADOR', revision: null, revisionPrevista: null, version: 3, cliente: null,
  creadoPor: 'g2@example.invalid', actualizadoEn: '2026-10-29T10:00:00Z', finalizadoEn: null, finalizadoPor: null, entorno: 'PRUEBA', propio: true, asignadoComoRevisor: false, pdf: null, huella: 'a'.repeat(64),
  especificacion: { datos: DATOS }, elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' }, autorizo: null, revisor: null, confirmaciones: [], responsables: [{ posicion: 1, funcion: 'GENERO', nombre: 'General Dos', conFirma: false, firma: null }],
  basadaEnRevision: null, creadoEn: '2026-10-29T10:00:00Z', actualizadoPor: 'g2@example.invalid', permisos: PERMISOS, ...over
});

function Abrir() {
  const d = useDocumento();
  useEffect(() => { void d.abrirPorId('rev-1'); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
function montar(opts: { carga?: CargaDocumento; datos?: EstadoDatos; bloqueos?: BloqueoFinal[]; doc?: DocumentoVista; onIntentar?: () => void } = {}) {
  m.obtenerDocumento.mockResolvedValue(opts.doc ?? vista());
  return render(
    <DocumentoProvider codigo="DOC001" carga={opts.carga ?? CARGA} onAbrirDocumento={() => undefined} autoguardar puedeCrear ediciones={0} retardoMs={20}>
      <Abrir />
      <BarraDocumento />
      <ResponsablesDocumento revisionDatos={<span>ranura-revision-datos</span>} />
      <FinalizarHojaDocumento datos={opts.datos ?? 'completos'} bloqueos={opts.bloqueos ?? []} faltantes={opts.bloqueos?.length ?? 0} contradicciones={0} onIntentar={opts.onIntentar} />
    </DocumentoProvider>
  );
}
const abierto = () => screen.findByRole('region', { name: 'Finalizar hoja' });

beforeEach(() => { m.listarRevisores.mockResolvedValue({ data: [] }); });
afterEach(() => { vi.clearAllMocks(); });

describe('Finalizar hoja · acciones y ubicación', () => {
  it('el botón de finalizar está UNA sola vez, en la sección final; el encabezado no tiene acciones de finalizar ni descartar', async () => {
    montar();
    const seccion = await abierto();
    const encabezado = screen.getByRole('region', { name: 'Estado y acciones de la hoja' });
    expect(within(encabezado).queryByRole('button', { name: /Finalizar|Descartar/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Finalizar y generar PDF' })).toHaveLength(1);
    expect(within(seccion).getByRole('button', { name: 'Descartar borrador' })).toBeInTheDocument();
    expect(screen.getByText('ranura-revision-datos')).toBeInTheDocument();                       // la confirmación de revisión de datos vive dentro de «Responsables y revisión»
  });

  it('muestra de forma compacta: guardado, datos y contradicciones (sin casilla ni chip de «Elaboró»)', async () => {
    montar({ datos: 'completos' });
    await abierto();
    expect(screen.getByTestId('final-guardado')).toHaveTextContent('Todo guardado');
    expect(screen.getByTestId('final-datos')).toHaveTextContent('Datos completos');
    expect(screen.getByTestId('final-contradicciones')).toHaveTextContent('Sin contradicciones pendientes');
    expect(screen.queryByTestId('final-elaboro')).not.toBeInTheDocument();                       // «Generó» se confirma al finalizar: ya no hay un paso aparte
  });

  it.each([['comprobando', 'Comprobando datos…'], ['faltan', 'Faltan datos obligatorios'], ['observaciones', 'Hay observaciones por revisar']] as const)('estado de datos «%s» → «%s»', async (estado, texto) => {
    montar({ datos: estado });
    await abierto();
    expect(screen.getByTestId('final-datos')).toHaveTextContent(texto);
  });
});

describe('Finalizar hoja · finalización segura', () => {
  it('sin bloqueos: confirma, usa la versión guardada y la finalización la vuelve a validar el servidor', async () => {
    const user = userEvent.setup();
    montar();
    await abierto();
    m.finalizarDocumento.mockResolvedValue(vista({ estado: 'FINALIZADA', revision: 1, finalizadoEn: '2026-10-29T11:00:00Z', finalizadoPor: 'g2@example.invalid', permisos: { ...PERMISOS, editar: false, finalizar: false } }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(m.finalizarDocumento).toHaveBeenCalledWith('rev-1', 3));
    expect(m.actualizarBorrador).not.toHaveBeenCalled();                                          // nada pendiente que guardar
  });

  it('con cambios pendientes los guarda ANTES de finalizar y finaliza con la versión nueva', async () => {
    const user = userEvent.setup();
    montar({ carga: { ...CARGA, datos: { ...DATOS, ancho: '99' } } });                              // la pantalla tiene un cambio que el servidor aún no conoce
    await abierto();
    m.actualizarBorrador.mockResolvedValue(vista({ version: 4, especificacion: { datos: { ...DATOS, ancho: '99' } } }));
    m.finalizarDocumento.mockResolvedValue(vista({ estado: 'FINALIZADA', revision: 1, version: 4, finalizadoEn: '2026-10-29T11:00:00Z', finalizadoPor: 'g2@example.invalid' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(m.finalizarDocumento).toHaveBeenCalledWith('rev-1', 4));
    expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
    expect(m.actualizarBorrador.mock.invocationCallOrder[0]!).toBeLessThan(m.finalizarDocumento.mock.invocationCallOrder[0]!);
  });

  it('si el guardado previo falla NO se finaliza y se indica el error', async () => {
    const user = userEvent.setup();
    montar({ carga: { ...CARGA, datos: { ...DATOS, ancho: '99' } } });
    await abierto();
    m.actualizarBorrador.mockRejectedValue(new docs.DocumentApiError('INVALID_DATA', 400, { fields: ['datos.ancho'] }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('final-guardado')).toHaveTextContent('No se pudo guardar'));
    expect(m.finalizarDocumento).not.toHaveBeenCalled();
  });

  it('si el servidor rechaza la finalización (validación definitiva) explica qué falta en la misma sección y el borrador sigue intacto', async () => {
    const user = userEvent.setup();
    montar();
    await abierto();
    m.finalizarDocumento.mockRejectedValue(new docs.DocumentApiError('FINALIZACION_NO_LISTA', 422, { motivos: [{ codigo: 'CLIENTE', mensaje: 'Identifica al cliente.' }] }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).getByRole('button', { name: 'Finalizar' }));
    expect(await within(await abierto()).findByText('Identifica al cliente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar y generar PDF' })).toBeEnabled();         // el borrador sigue; se puede corregir y reintentar
    expect(m.descartarBorrador).not.toHaveBeenCalled();
  });

  it('si la base rechaza los datos (SPEC_INVALID) muestra un motivo comprensible, sin el genérico ni la consulta de «resultado incierto»', async () => {
    const user = userEvent.setup();
    montar();
    await abierto();
    m.obtenerDocumento.mockClear();
    m.finalizarDocumento.mockRejectedValue(new docs.DocumentApiError('SPEC_INVALID', 422, { code: 'SPEC_INVALID', message: 'Los datos guardados no cumplen las restricciones del documento.' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).getByRole('button', { name: 'Finalizar' }));
    const seccion = await abierto();
    expect(await within(seccion).findByText(/El servidor rechazó los datos del documento/)).toBeInTheDocument();
    expect(seccion).not.toHaveTextContent('La operación no se pudo completar');
    expect(seccion).not.toHaveTextContent('Se comprobó en el servidor');
    expect(m.obtenerDocumento).not.toHaveBeenCalled();                                            // respuesta definitiva del servidor: no se consulta el estado
    expect(screen.getByRole('button', { name: 'Finalizar y generar PDF' })).toBeEnabled();
  });
});

describe('Finalizar hoja · bloqueos conocidos', () => {
  it('con datos faltantes explica qué falta y ofrece ir al campo; no abre la confirmación ni finaliza', async () => {
    const user = userEvent.setup();
    const irA = vi.fn();
    const onIntentar = vi.fn();
    montar({ datos: 'faltan', bloqueos: [{ clave: 'f1', texto: 'Falta el ancho.', irA }], onIntentar });
    await abierto();
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    const lista = await screen.findByTestId('final-bloqueos');
    expect(lista).toHaveTextContent('Falta el ancho.');
    await user.click(within(lista).getByRole('button', { name: 'Ir al campo: Falta el ancho.' }));
    expect(irA).toHaveBeenCalledTimes(1);
    expect(onIntentar).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(m.finalizarDocumento).not.toHaveBeenCalled();
  });

  it('con «Generó» ya sin casilla: el nombre llega como bloqueo propio de la pantalla (con acceso al campo) y nunca se pide confirmar «Elaboró»', async () => {
    const user = userEvent.setup();
    const irA = vi.fn();
    montar({ bloqueos: [{ clave: 'genero', texto: 'Indica el nombre de quien generó la hoja.', irA }] });
    await abierto();
    expect(screen.queryByText(/Falta confirmar «Elaboró»/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    const bloqueos = await screen.findByTestId('final-bloqueos');
    expect(bloqueos).toHaveTextContent('Indica el nombre de quien generó la hoja.');
    await user.click(within(bloqueos).getByRole('button', { name: /Ir al campo/ }));
    expect(irA).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(m.finalizarDocumento).not.toHaveBeenCalled();
  });
});

describe('Finalizar hoja · descartar y revisión humana', () => {
  it('«Descartar borrador» es secundario y exige confirmación: cancelar no descarta', async () => {
    const user = userEvent.setup();
    montar();
    const seccion = await abierto();
    await user.click(within(seccion).getByRole('button', { name: 'Descartar borrador' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Descartar el borrador' });
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(m.descartarBorrador).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());           // el diálogo oculta la página mientras se cierra
    await user.click(within(seccion).getByRole('button', { name: 'Descartar borrador' }));
    m.descartarBorrador.mockResolvedValue(vista({ estado: 'DESCARTADA' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Descartar el borrador' })).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(m.descartarBorrador).toHaveBeenCalledWith('rev-1', 3));
  });

  it('la revisión humana es opcional: plegada, no se registra sola y solo se confirma con la acción explícita', async () => {
    const user = userEvent.setup();
    montar();
    await abierto();
    const responsables = screen.getByRole('region', { name: 'Responsables y revisión' });
    expect(within(responsables).getByText('No es requisito para finalizar')).toBeInTheDocument();
    expect(m.registrarRevision).not.toHaveBeenCalled();
    await user.click(within(responsables).getByRole('button', { name: /Revisión del borrador \(opcional\)/ }));
    m.registrarRevision.mockResolvedValue(vista({ confirmaciones: [{ usuario: 'General Dos', correo: 'g2@example.invalid', version: 3, vigente: true, autorrevision: true, comoRevisorAsignado: false, registradaEn: '2026-10-29T10:30:00Z' }] }));
    await user.click(await within(responsables).findByRole('button', { name: 'Registrar mi revisión' }));
    expect(m.registrarRevision).toHaveBeenCalledTimes(1);
    expect(m.registrarRevision).toHaveBeenCalledWith('rev-1', 3);                                  // ligada a la versión (huella) vigente
  });

  it('finalizar no exige la revisión humana: sin ninguna revisión registrada se puede confirmar la finalización', async () => {
    const user = userEvent.setup();
    montar();
    await abierto();
    await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
    expect(await screen.findByRole('dialog', { name: 'Finalizar la hoja' })).toBeInTheDocument();
    expect(screen.queryByTestId('final-bloqueos')).not.toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as docs from '../services/manufacturingDocuments';
import { DocumentApiError, type DocumentoVista, type ResumenDocumento } from '../services/manufacturingDocuments';
import type { CargaDocumento } from './documentSpec';
import { DocumentPanel } from './DocumentPanel';

vi.mock('../services/manufacturingDocuments', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/manufacturingDocuments')>();
  return {
    ...real, crearBorrador: vi.fn(), actualizarBorrador: vi.fn(), obtenerDocumento: vi.fn(), descartarBorrador: vi.fn(), listarAbiertos: vi.fn(), historialPorCodigo: vi.fn(), listarRevisores: vi.fn(),
    asignarRevisor: vi.fn(), registrarRevision: vi.fn(), finalizarDocumento: vi.fn(), cancelarFinalizacion: vi.fn(), crearRevisionNueva: vi.fn(), descargarPdfFinalizado: vi.fn()
  };
});
const m = vi.mocked(docs);

const CARGA: CargaDocumento = { familia: 'BOLSA_PLANA_1', datos: { codigo: 'DOC001', ancho: '13' }, procedencia: { ancho: 'BIND' }, incidenciasReconocidas: [] };
const PERMISOS = { editar: true, finalizar: true, asignarRevisor: true, registrarRevision: true, crearRevisionNueva: false, descargarPdf: false };
function vista(over: Partial<DocumentoVista> = {}): DocumentoVista {
  return {
    id: 'rev-1', documentoId: 'doc-1', codigo: 'DOC001', variante: null, familia: 'BOLSA_PLANA_1', estado: 'BORRADOR', revision: null, revisionPrevista: null, version: 1, cliente: null,
    creadoPor: 'g2@example.invalid', actualizadoEn: '2026-10-29T10:00:00Z', finalizadoEn: null, finalizadoPor: null, entorno: 'PRUEBA', propio: true, asignadoComoRevisor: false, pdf: null,
    huella: 'a'.repeat(64), especificacion: { datos: { codigo: 'DOC001', ancho: '13' } }, elaboro: { nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' }, autorizo: null, revisor: null, confirmaciones: [],
    basadaEnRevision: null, creadoEn: '2026-10-29T10:00:00Z', actualizadoPor: 'g2@example.invalid', permisos: PERMISOS, ...over
  };
}
const finalizada = (over: Partial<DocumentoVista> = {}) => vista({ estado: 'FINALIZADA', revision: 1, finalizadoEn: '2026-10-29T11:00:00Z', finalizadoPor: 'g2@example.invalid', pdf: { nombre: 'DOC001_REV01.pdf', sha256: 'b'.repeat(64), bytes: 1000 }, elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' }, permisos: { ...PERMISOS, editar: false, finalizar: false, asignarRevisor: false, registrarRevision: false, crearRevisionNueva: true, descargarPdf: true }, ...over });
const resumen = (over: Partial<ResumenDocumento> = {}): ResumenDocumento => ({ id: 'rev-9', documentoId: 'doc-9', codigo: 'DOC009', variante: 'Doblada', familia: 'COEX', estado: 'BORRADOR', revision: null, revisionPrevista: null, version: 2, cliente: null, creadoPor: 'g2@example.invalid', actualizadoEn: '2026-10-29T10:00:00Z', finalizadoEn: null, finalizadoPor: null, entorno: 'PRUEBA', propio: true, asignadoComoRevisor: false, pdf: null, ...over });
const err = (kind: docs.DocumentErrorKind, status = 409, body: Record<string, unknown> = {}) => new DocumentApiError(kind, status, body);

let clic: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
  clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  m.listarAbiertos.mockResolvedValue({ data: [] });
  m.listarRevisores.mockResolvedValue({ data: [{ id: '3', displayName: 'General Tres' }, { id: '1', displayName: 'Admin Uno' }] });
});
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

function montar(props: Partial<Parameters<typeof DocumentPanel>[0]> = {}) {
  const onAbrirDocumento = vi.fn();
  const user = userEvent.setup();
  const vistaMontada = render(<DocumentPanel codigo="DOC001" carga={CARGA} onAbrirDocumento={onAbrirDocumento} {...props} />);
  return { user, onAbrirDocumento, ...vistaMontada };
}
/** Monta con un documento ya abierto (crea el borrador desde el panel, como lo haría el usuario). */
async function conDocumento(doc: DocumentoVista, props: Partial<Parameters<typeof DocumentPanel>[0]> = {}) {
  m.crearBorrador.mockResolvedValue(doc);
  const r = montar(props);
  await r.user.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await screen.findByText(/Borrador guardado\./);
  return r;
}
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

describe('DocumentPanel · guardar y recuperar', () => {
  it('sin guardar: marca de PRUEBA, «Sin guardar», y el botón se activa solo con familia elegida', async () => {
    const { rerender, onAbrirDocumento } = montar({ carga: null });
    expect(screen.getByText('PRUEBA · NO VÁLIDO PARA PRODUCCIÓN')).toBeInTheDocument();
    expect(screen.getByText('Sin guardar')).toBeInTheDocument();
    expect(boton('Guardar borrador')).toBeDisabled();
    expect(screen.getByText('Elige la familia para poder guardar.')).toBeInTheDocument();
    rerender(<DocumentPanel codigo="DOC001" carga={CARGA} onAbrirDocumento={onAbrirDocumento} />);
    expect(boton('Guardar borrador')).toBeEnabled();
  });

  it('guarda el borrador con el código, la variante y la carga; no envía identidad; muestra el documento guardado', async () => {
    m.crearBorrador.mockResolvedValue(vista({ variante: 'Doblada' }));
    const { user } = montar();
    await user.type(screen.getByLabelText('Variante (opcional)'), ' Doblada ');
    await user.click(boton('Guardar borrador'));
    await screen.findByText('Borrador guardado.');
    expect(m.crearBorrador).toHaveBeenCalledWith({ codigo: 'DOC001', variante: 'Doblada', ...CARGA });
    expect(Object.keys(m.crearBorrador.mock.calls[0]![0])).not.toContain('usuario');
    expect(screen.getByText('DOC001 · Doblada · Borrador · v1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Variante (opcional)')).not.toBeInTheDocument();
  });

  it('un código ya usado muestra el mensaje uniforme, sin datos del servidor, y no deja un documento a medias', async () => {
    m.crearBorrador.mockRejectedValue(err('DOCUMENT_EXISTS', 409, { message: '<b>interno</b>', borradorId: 'x' }));
    const { user } = montar();
    await user.click(boton('Guardar borrador'));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Ya existe un documento con ese código y variante');
    expect(alerta).not.toHaveTextContent('interno');
    expect(screen.getByText('Sin guardar')).toBeInTheDocument();
  });

  it('si el gestor aún no está activo en la API lo dice con claridad', async () => {
    m.crearBorrador.mockRejectedValue(err('INACTIVE', 404));
    const { user } = montar();
    await user.click(boton('Guardar borrador'));
    expect(await screen.findByRole('alert')).toHaveTextContent('todavía no está activo');
  });

  it('actualiza con la versión que se vio; detecta cambios sin guardar', async () => {
    const { user, rerender, onAbrirDocumento } = await conDocumento(vista());
    expect(boton('Guardar cambios')).toBeDisabled();
    const editada: CargaDocumento = { ...CARGA, datos: { ...CARGA.datos, ancho: '15' } };
    rerender(<DocumentPanel codigo="DOC001" carga={editada} onAbrirDocumento={onAbrirDocumento} />);
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    m.actualizarBorrador.mockResolvedValue(vista({ version: 2, especificacion: { datos: editada.datos } }));
    await user.click(boton('Guardar cambios'));
    await screen.findByText('Cambios guardados.');
    expect(m.actualizarBorrador).toHaveBeenCalledWith('rev-1', { version: 1, ...editada });
    expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
    expect(screen.getByText('DOC001 · Borrador · v2')).toBeInTheDocument();
  });

  it('conflicto de versión: avisa, conserva lo que hay en pantalla y ofrece recargar la versión vigente', async () => {
    const { user, rerender, onAbrirDocumento } = await conDocumento(vista());
    const editada: CargaDocumento = { ...CARGA, datos: { ...CARGA.datos, ancho: '15' } };
    rerender(<DocumentPanel codigo="DOC001" carga={editada} onAbrirDocumento={onAbrirDocumento} />);
    m.actualizarBorrador.mockRejectedValue(err('VERSION_CONFLICT', 409, { versionActual: 4 }));
    await user.click(boton('Guardar cambios'));
    expect(await screen.findByRole('alert')).toHaveTextContent('El borrador cambió desde que lo abriste');
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();
    m.obtenerDocumento.mockResolvedValue(vista({ version: 4, especificacion: { datos: { codigo: 'DOC001', ancho: '20' } } }));
    await user.click(boton(/Recargar la versión vigente/));
    await screen.findByText('Se cargó la versión vigente del servidor.');
    expect(onAbrirDocumento).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }));
  });

  it('un documento abierto se olvida cuando se busca otro producto', async () => {
    const { rerender, onAbrirDocumento } = await conDocumento(vista());
    expect(screen.getByText('DOC001 · Borrador · v1')).toBeInTheDocument();
    rerender(<DocumentPanel codigo="OTRO77" carga={CARGA} onAbrirDocumento={onAbrirDocumento} />);
    await waitFor(() => expect(screen.getByText('Sin guardar')).toBeInTheDocument());
  });
});

describe('DocumentPanel · Elaboró, Autorizó, revisor y revisión', () => {
  it('«Elaboró» llega sugerido desde la cuenta y se confirma con una acción explícita', async () => {
    const { user } = await conDocumento(vista());
    const campo = screen.getByLabelText('Elaboró') as HTMLInputElement;
    expect(campo.value).toBe('General Dos');
    expect(screen.getByText(/Sugerido desde tu cuenta: General Dos/)).toBeInTheDocument();
    m.actualizarBorrador.mockResolvedValue(vista({ version: 2, elaboro: { nombre: 'Ing. Ana Pérez', confirmado: true, sugerido: 'General Dos' } }));
    await user.clear(campo); await user.type(campo, 'Ing. Ana Pérez');
    await user.click(boton('Confirmar «Elaboró»'));
    await screen.findByText('Elaboró confirmado.');
    expect(m.actualizarBorrador).toHaveBeenCalledWith('rev-1', { version: 1, elaboroNombre: 'Ing. Ana Pérez', elaboroConfirmado: true });
    expect(screen.getByText('Elaboró confirmado')).toBeInTheDocument();
  });

  it('si el nombre cambia después de confirmar, vuelve a pedir la confirmación', async () => {
    const { user } = await conDocumento(vista({ elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' } }));
    expect(screen.getByText('Elaboró confirmado')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Elaboró'), ' López');
    expect(boton('Confirmar «Elaboró»')).toBeEnabled();
  });

  it('Autorizó es opcional y se guarda aparte', async () => {
    const { user } = await conDocumento(vista());
    m.actualizarBorrador.mockResolvedValue(vista({ version: 2, autorizo: 'Dirección' }));
    await user.type(screen.getByLabelText('Autorizó'), 'Dirección');
    await user.click(boton('Guardar Autorizó'));
    await screen.findByText(/Autorizó actualizado/);
    expect(m.actualizarBorrador).toHaveBeenCalledWith('rev-1', { version: 1, autorizoNombre: 'Dirección' });
  });

  it('asigna un revisor de la lista de cuentas activas y puede retirarlo', async () => {
    const { user } = await conDocumento(vista());
    await waitFor(() => expect(m.listarRevisores).toHaveBeenCalled());
    await user.click(screen.getByLabelText('Revisor asignado'));
    await user.click(await screen.findByRole('option', { name: 'General Tres' }));
    m.asignarRevisor.mockResolvedValue(vista({ version: 2, revisor: { id: '3', nombre: 'General Tres' } }));
    await user.click(boton('Asignar revisor'));
    await screen.findByText('Revisor asignado.');
    expect(m.asignarRevisor).toHaveBeenCalledWith('rev-1', 1, '3');
    await user.click(screen.getByLabelText('Revisor asignado'));
    await user.click(await screen.findByRole('option', { name: 'Sin revisor' }));
    m.asignarRevisor.mockResolvedValue(vista({ version: 3 }));
    await user.click(boton('Asignar revisor'));
    await screen.findByText('Revisor retirado.');
    expect(m.asignarRevisor).toHaveBeenLastCalledWith('rev-1', 2, null);
  });

  it('«Registrar mi revisión» no envía ningún nombre; muestra quién revisó y avisa de autorrevisión y revisiones sin vigencia', async () => {
    const { user } = await conDocumento(vista({ confirmaciones: [
      { usuario: 'General Dos', correo: 'g2@example.invalid', version: 1, vigente: true, autorrevision: true, comoRevisorAsignado: false, registradaEn: '2026-10-29T10:30:00Z' },
      { usuario: 'General Tres', correo: 'g3@example.invalid', version: 0, vigente: false, autorrevision: false, comoRevisorAsignado: true, registradaEn: '2026-10-29T10:10:00Z' }
    ] }));
    expect(screen.getByText('Revisó: General Dos (autorrevisión)')).toBeInTheDocument();
    expect(screen.getByText('1 revisión(es) sin vigencia por cambios técnicos')).toBeInTheDocument();
    m.registrarRevision.mockResolvedValue(vista());
    await user.click(boton('Registrar mi revisión'));
    await screen.findByText(/Tu revisión quedó registrada/);
    expect(m.registrarRevision).toHaveBeenCalledWith('rev-1', 1);
  });

  it('con cambios sin guardar no se revisa ni se finaliza (la revisión se liga a la versión guardada)', async () => {
    const { rerender, onAbrirDocumento } = await conDocumento(vista());
    rerender(<DocumentPanel codigo="DOC001" carga={{ ...CARGA, datos: { ...CARGA.datos, ancho: '99' } }} onAbrirDocumento={onAbrirDocumento} />);
    expect(boton('Registrar mi revisión')).toBeDisabled();
    expect(boton('Finalizar hoja')).toBeDisabled();
    expect(screen.getByText(/Guarda los cambios antes de revisar/)).toBeInTheDocument();
  });

  it('una cuenta sin permiso de edición (revisor asignado) ve el borrador sin poder modificarlo ni finalizarlo', async () => {
    await conDocumento(vista({ propio: false, asignadoComoRevisor: true, revisor: { id: '3', nombre: 'General Tres' }, permisos: { ...PERMISOS, editar: false, finalizar: false, asignarRevisor: false } }));
    expect(boton('Guardar cambios')).toBeDisabled();
    expect(screen.getByLabelText('Elaboró')).toBeDisabled();
    expect(boton('Finalizar hoja')).toBeDisabled();
    expect(boton('Descartar borrador')).toBeDisabled();
    expect(boton('Registrar mi revisión')).toBeEnabled();
    expect(screen.getByText('Revisor asignado: General Tres')).toBeInTheDocument();
    expect(screen.queryByLabelText('Revisor asignado')).not.toBeInTheDocument();
  });
});

describe('DocumentPanel · finalizar, descargar y nueva revisión', () => {
  it('finaliza tras confirmar; muestra la versión finalizada con su PDF y no permite editar', async () => {
    const { user } = await conDocumento(vista({ elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' } }));
    await user.click(boton('Finalizar hoja'));
    const dialogo = await screen.findByRole('dialog', { name: 'Finalizar la hoja' });
    expect(within(dialogo).getByText(/PRUEBA · NO VÁLIDO PARA PRODUCCIÓN/)).toBeInTheDocument();
    m.finalizarDocumento.mockResolvedValue(finalizada());
    await user.click(within(dialogo).getByRole('button', { name: 'Finalizar' }));
    await screen.findByText('Hoja finalizada. El PDF quedó almacenado.');
    expect(m.finalizarDocumento).toHaveBeenCalledWith('rev-1', 1);
    expect(screen.getByText('DOC001 · REV01 · v1')).toBeInTheDocument();
    expect(screen.getByText(/Archivo: DOC001_REV01.pdf/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalizar hoja' })).not.toBeInTheDocument();
  });

  it('si faltan requisitos muestra cada motivo; la revisión sigue como borrador', async () => {
    const { user } = await conDocumento(vista());
    m.finalizarDocumento.mockRejectedValue(err('FINALIZACION_NO_LISTA', 422, { motivos: [
      { codigo: 'ELABORO_SIN_CONFIRMAR', mensaje: 'Confirma expresamente el nombre de quien elaboró.' },
      { codigo: 'HOJA_INCOMPLETA', mensaje: 'Faltan datos técnicos para esta familia.', detalle: ['Ancho'] }
    ] }));
    await user.click(boton('Finalizar hoja'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    const requisitos = await screen.findByLabelText('Requisitos pendientes');
    expect(requisitos).toHaveTextContent('Confirma expresamente el nombre de quien elaboró.');
    expect(requisitos).toHaveTextContent('Faltan datos técnicos para esta familia. (Ancho)');
    expect(screen.getByText('DOC001 · Borrador · v1')).toBeInTheDocument();
  });

  it('sin Chrome en el servidor: mensaje claro y el borrador sigue disponible', async () => {
    const { user } = await conDocumento(vista());
    m.finalizarDocumento.mockRejectedValue(err('PDF_NOT_AVAILABLE', 501));
    await user.click(boton('Finalizar hoja'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La revisión sigue como borrador');
    expect(boton('Finalizar hoja')).toBeEnabled();
  });

  it('cliente renombrado en el catálogo: muestra el nombre vigente y no finaliza', async () => {
    const { user } = await conDocumento(vista());
    m.finalizarDocumento.mockRejectedValue(err('CLIENTE_ACTUALIZADO', 409, { nombreActual: 'Nuevo SA' }));
    await user.click(boton('Finalizar hoja'));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nombre vigente: «Nuevo SA».');
  });

  it('versión finalizada: descarga el PDF con el nombre del servidor; crear nueva revisión abre el borrador resultante', async () => {
    const { user, onAbrirDocumento } = await conDocumento(finalizada());
    m.descargarPdfFinalizado.mockResolvedValue({ blob: new Blob(['%PDF-1.4 x']), filename: 'DOC001_REV01.pdf', sha256: null });
    await user.click(boton('Descargar PDF finalizado'));
    await screen.findByText('PDF descargado.');
    expect(m.descargarPdfFinalizado).toHaveBeenCalledWith('rev-1');
    expect(clic).toHaveBeenCalledTimes(1);
    m.crearRevisionNueva.mockResolvedValue(vista({ id: 'rev-2', version: 1, basadaEnRevision: 1 }));
    await user.click(boton('Crear nueva revisión'));
    await screen.findByText(/Nueva revisión creada/);
    expect(m.crearRevisionNueva).toHaveBeenCalledWith('doc-1');
    expect(onAbrirDocumento).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-2' }));
    expect(screen.getByText('DOC001 · Borrador · v1')).toBeInTheDocument();
  });

  it('sin permiso para crear revisiones nuevas el botón está deshabilitado y se explica', async () => {
    await conDocumento(finalizada({ permisos: { ...PERMISOS, editar: false, crearRevisionNueva: false, descargarPdf: true } }));
    expect(boton('Crear nueva revisión')).toBeDisabled();
    expect(screen.getByText(/Solo el creador del documento o un administrador/)).toBeInTheDocument();
  });

  it('finalización en curso: se puede cancelar; el contenido está congelado', async () => {
    const { user } = await conDocumento(vista({ estado: 'FINALIZANDO', revisionPrevista: 2 }));
    expect(screen.getByText(/Hay una finalización en curso \(REV02 \(en curso\)\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    m.cancelarFinalizacion.mockResolvedValue(vista({ version: 1 }));
    await user.click(boton('Cancelar finalización'));
    await screen.findByText(/Finalización cancelada/);
    expect(m.cancelarFinalizacion).toHaveBeenCalledWith('rev-1', 1);
  });

  it('descartar pide confirmación', async () => {
    const { user } = await conDocumento(vista());
    await user.click(boton('Descartar borrador'));
    m.descartarBorrador.mockResolvedValue(vista({ estado: 'DESCARTADA', version: 2 }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Descartar' }));
    await screen.findByText('Borrador descartado.');
    expect(screen.getByText('Este borrador fue descartado.')).toBeInTheDocument();
  });
});

describe('DocumentPanel · historial documental', () => {
  it('lista el trabajo en curso y el historial por código; abre un documento y descarga un PDF finalizado', async () => {
    m.listarAbiertos.mockResolvedValue({ data: [resumen()] });
    m.historialPorCodigo.mockResolvedValue({ data: [resumen({ id: 'rev-5', codigo: 'DOC001', variante: null, estado: 'FINALIZADA', revision: 1, finalizadoEn: '2026-10-29T11:00:00Z', finalizadoPor: 'g2@example.invalid', pdf: { nombre: 'DOC001_REV01.pdf', sha256: 'c'.repeat(64), bytes: 10 }, propio: false })] });
    const { user, onAbrirDocumento } = montar();
    await user.click(boton('Mis borradores e historial'));
    const dialogo = await screen.findByRole('dialog', { name: 'Mis borradores e historial documental' });
    await within(dialogo).findByText('DOC009');
    expect(within(dialogo).getByText('Borrador · Borrador')).toBeInTheDocument();
    await within(dialogo).findByText('Finalizada · REV01');
    expect(m.historialPorCodigo).toHaveBeenCalledWith('DOC001');

    m.descargarPdfFinalizado.mockResolvedValue({ blob: new Blob(['%PDF-1.4']), filename: 'DOC001_REV01.pdf', sha256: null });
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar PDF DOC001_REV01.pdf' }));
    await waitFor(() => expect(m.descargarPdfFinalizado).toHaveBeenCalledWith('rev-5'));

    m.obtenerDocumento.mockResolvedValue(vista({ id: 'rev-9', codigo: 'DOC009', variante: 'Doblada', version: 2 }));
    await user.click(within(dialogo).getByRole('button', { name: /Abrir DOC009 Doblada Borrador/ }));
    await waitFor(() => expect(onAbrirDocumento).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-9' })));
    expect(m.obtenerDocumento).toHaveBeenCalledWith('rev-9');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('valida el código antes de buscar y no filtra nada en el navegador: lo que el backend no devuelve no se muestra', async () => {
    m.listarAbiertos.mockResolvedValue({ data: [] });
    const { user } = montar({ codigo: null });
    await user.click(boton('Mis borradores e historial'));
    const dialogo = await screen.findByRole('dialog');
    await within(dialogo).findByText('No tienes borradores ni finalizaciones en curso.');
    await user.type(within(dialogo).getByLabelText('Código DCMX'), '../x');
    await user.click(within(dialogo).getByRole('button', { name: 'Buscar' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Escribe un código DCMX válido');
    expect(m.historialPorCodigo).not.toHaveBeenCalled();
    m.historialPorCodigo.mockResolvedValue({ data: [] });
    await user.clear(within(dialogo).getByLabelText('Código DCMX')); await user.type(within(dialogo).getByLabelText('Código DCMX'), 'AJENO1');
    await user.click(within(dialogo).getByRole('button', { name: 'Buscar' }));
    await within(dialogo).findByText('No hay versiones visibles para ese código.');
  });
});

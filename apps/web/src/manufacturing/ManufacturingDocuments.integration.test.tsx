import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listBindRecent } from '../services/bindRecent';
import { listClients } from '../services/clients';
import * as docs from '../services/manufacturingDocuments';
import type { DocumentoVista } from '../services/manufacturingDocuments';
import { listManufacturingFamilies } from '../services/manufacturingFamilies';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { familyConfigs, schfpmg001 } from '../test/bindProductFixtures';
import { guardarArchivo } from './downloadFile';
import { ManufacturingSpecificationPage } from './ManufacturingSpecificationPage';

// Experiencia unificada: buscar un código DCMX → ver el producto y sus hojas → abrir/continuar, ver, descargar, crear nueva revisión o preparar una hoja nueva. Servicios simulados (ni API ni base de datos).
vi.mock('../services/bindProducts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindProducts')>()), lookupBindProductByCode: vi.fn() }));
vi.mock('../services/bindRecent', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindRecent')>()), listBindRecent: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
vi.mock('../services/manufacturingFamilies', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/manufacturingFamilies')>()), listManufacturingFamilies: vi.fn() }));
vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn(), downloadDraftPdf: vi.fn() }));
vi.mock('./downloadFile', () => ({ guardarArchivo: vi.fn() }));
vi.mock('../services/manufacturingDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/manufacturingDocuments')>()),
  crearBorrador: vi.fn(), actualizarBorrador: vi.fn(), obtenerDocumento: vi.fn(), listarAbiertos: vi.fn(), historialPorCodigo: vi.fn(), listarRevisores: vi.fn(),
  finalizarDocumento: vi.fn(), crearRevisionNueva: vi.fn(), descargarPdfFinalizado: vi.fn()
}));
const m = vi.mocked(docs);
const lookupMock = vi.mocked(lookupBindProductByCode);

const PERMISOS = { editar: true, finalizar: true, asignarRevisor: true, registrarRevision: true, crearRevisionNueva: false, descargarPdf: false };
const guardado = (over: Partial<DocumentoVista> = {}): DocumentoVista => ({
  id: 'rev-1', documentoId: 'doc-1', codigo: 'SCHFPMG001', variante: null, familia: 'BOLSA_PLANA_1', estado: 'BORRADOR', revision: null, revisionPrevista: null, version: 3, cliente: null,
  creadoPor: 'g2@example.invalid', actualizadoEn: '2026-10-29T10:00:00Z', finalizadoEn: null, finalizadoPor: null, entorno: 'PRUEBA', propio: true, asignadoComoRevisor: false, pdf: null, huella: 'a'.repeat(64),
  especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', largo: '88' } }, elaboro: { nombre: 'General Dos', confirmado: false, sugerido: 'General Dos' }, autorizo: null, revisor: null, confirmaciones: [],
  basadaEnRevision: null, creadoEn: '2026-10-29T10:00:00Z', actualizadoPor: 'g2@example.invalid', permisos: PERMISOS, ...over
});
const PDF = { nombre: 'SCHFPMG001_REV01.pdf', sha256: 'c'.repeat(64), bytes: 1000 };
const finalizada = (over: Partial<DocumentoVista> = {}): DocumentoVista => guardado({
  id: 'rev-fin', estado: 'FINALIZADA', revision: 1, revisionPrevista: 1, finalizadoEn: '2026-10-29T11:00:00Z', finalizadoPor: 'g2@example.invalid', pdf: PDF,
  elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' }, permisos: { ...PERMISOS, editar: false, finalizar: false, asignarRevisor: false, registrarRevision: false, crearRevisionNueva: true, descargarPdf: true }, ...over
});

beforeEach(() => {
  vi.mocked(listManufacturingFamilies).mockResolvedValue(familyConfigs);
  vi.mocked(listBindRecent).mockResolvedValue({ data: [], meta: { orden: 'CreationDate desc', limite: 10, ordenFiable: true } } as never);
  vi.mocked(listClients).mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
  vi.mocked(previewManufacturingSheet).mockResolvedValue({ html: '<p>x</p>', familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: null });
  lookupMock.mockResolvedValue(schfpmg001());
  m.listarAbiertos.mockResolvedValue({ data: [] });
  m.listarRevisores.mockResolvedValue({ data: [] });
  m.historialPorCodigo.mockResolvedValue({ data: [] });
});
afterEach(() => { vi.clearAllMocks(); });

// El diálogo «Mis hojas» oculta el resto de la página a los roles accesibles mientras se cierra: se espera a que desaparezca antes de consultar.
const cerrado = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
const pagina = (documentos?: boolean) => render(<MemoryRouter><ManufacturingSpecificationPage documentos={documentos} /></MemoryRouter>);
async function buscar(user: ReturnType<typeof userEvent.setup>, code = 'SCHFPMG001') {
  fireEvent.change(screen.getByLabelText('Código DCMX a buscar'), { target: { value: code } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Buscar' }));
  return screen.findByTestId('hojas-del-codigo');
}
const enLista = (lista: HTMLElement, nombre: RegExp) => within(lista).findByRole('button', { name: nombre });
async function abrirDesdeMisHojas(user: ReturnType<typeof userEvent.setup>, nombre: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Mis hojas' }));
  const dialogo = await screen.findByRole('dialog');
  await user.click(await within(dialogo).findByRole('button', { name: nombre }));
  await cerrado();
}
const ancho = () => screen.findByLabelText('Ancho') as Promise<HTMLInputElement>;

describe('hojas de manufactura: búsqueda unificada por código DCMX', { timeout: 30_000 }, () => {
  it('apagado por defecto: la página conserva su comportamiento anterior (solo memoria) y no llama al gestor', async () => {
    pagina();
    expect(await screen.findByLabelText('Código DCMX a buscar')).toBeInTheDocument();
    expect(screen.queryByTestId('hojas-del-codigo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mis hojas' })).not.toBeInTheDocument();
    expect(screen.getByText(/Los datos solo existen en memoria/)).toBeInTheDocument();
    expect(m.historialPorCodigo).not.toHaveBeenCalled();
  });

  it('1) un código sin hoja: ofrece preparar una nueva con BIND, no crea nada al buscar y guarda el borrador solo al pedirlo', async () => {
    const user = userEvent.setup();
    pagina(true);
    const lista = await buscar(user);
    expect(m.historialPorCodigo).toHaveBeenCalledWith('SCHFPMG001', expect.anything());
    expect(await within(lista).findByText(/Sin hojas guardadas accesibles/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();                // todavía no hay formulario
    expect(m.crearBorrador).not.toHaveBeenCalled();                                  // consultar BIND no crea documentos
    await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    expect(m.crearBorrador).not.toHaveBeenCalled();
    // Una hoja PREPARADA (solo en pantalla) se distingue de un borrador guardado en PostgreSQL; el producto se muestra compacto y sin una tarjeta «Estado de la hoja».
    expect(screen.getByTestId('estado-sin-guardar')).toHaveTextContent('Hoja preparada · sin guardar');
    expect(screen.queryByText('Guardada en PostgreSQL (TEST)')).not.toBeInTheDocument();
    expect(screen.getByTestId('bind-codigo')).toHaveTextContent('SCHFPMG001');
    expect(screen.getByTestId('bind-descripcion')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Estado de la hoja' })).not.toBeInTheDocument();
    m.crearBorrador.mockResolvedValue(guardado());
    await user.click(await screen.findByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador guardado.');
    expect(screen.getByText('Guardada en PostgreSQL (TEST)')).toBeInTheDocument();
    expect(screen.queryByTestId('estado-sin-guardar')).not.toBeInTheDocument();
    const enviado = m.crearBorrador.mock.calls[0]![0];
    expect(enviado).toMatchObject({ codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', bind: { Code: 'SCHFPMG001' } });
    expect(Object.keys(enviado)).not.toEqual(expect.arrayContaining(['usuario', 'estado', 'revision']));
    expect(screen.getByText(/SCHFPMG001 · Borrador · v3/)).toBeInTheDocument();
  });

  it('2) al buscar otra vez el mismo código aparece el borrador y se continúa editando con sus datos guardados', async () => {
    const user = userEvent.setup();
    pagina(true);
    m.historialPorCodigo.mockResolvedValue({ data: [guardado()] });
    m.obtenerDocumento.mockResolvedValue(guardado());
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    expect((await ancho()).value).toBe('77');
    expect((screen.getByLabelText('Largo') as HTMLInputElement).value).toBe('88');
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).toBeChecked();
    expect((screen.getByLabelText('Elaboró') as HTMLInputElement).value).toBe('General Dos');
    expect(lookupMock).toHaveBeenCalledTimes(1);                                     // solo la búsqueda; abrir no vuelve a consultar BIND
  });

  it('3) con BIND caído una hoja guardada se abre y se edita; preparar una nueva queda deshabilitado; la consulta explícita falla sin afectar al documento', async () => {
    const user = userEvent.setup();
    pagina(true);
    m.historialPorCodigo.mockResolvedValue({ data: [guardado()] });
    m.obtenerDocumento.mockResolvedValue(guardado());
    lookupMock.mockRejectedValue(new BindProductApiError('BIND_UNAVAILABLE', 503));
    const lista = await buscar(user);
    expect(await within(lista).findByText(/No se pudo consultar BIND en este momento\./)).toBeInTheDocument();
    expect(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' })).toBeDisabled();
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    expect((await ancho()).value).toBe('77');
    expect(screen.getByTestId('bind-guardado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Consultar BIND ahora (solo lectura)' }));
    expect(await screen.findByText(/El documento abierto no se ve afectado/)).toBeInTheDocument();
    expect((screen.getByLabelText('Ancho') as HTMLInputElement).value).toBe('77');
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
  });

  it('4) editar y guardar conserva los datos técnicos guardados (calibre literal, color personalizado) y no cambia nada más', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado({ especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', largo: '88', calibre: '2.5 MIL', colorNombre: 'Azul Cielo Especial', colorHex: '#3778c8' } } });
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    expect(await screen.findByTestId('color-personalizado-vista')).toHaveTextContent('Azul Cielo Especial · #3778C8');
    fireEvent.change(await ancho(), { target: { value: '99' } });
    m.actualizarBorrador.mockResolvedValue(guardado({ version: 4 }));
    await user.click(await screen.findByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');
    const [id, cambios] = m.actualizarBorrador.mock.calls[0]!;
    expect(id).toBe('rev-1');
    expect(cambios).toMatchObject({ version: 3, datos: { ancho: '99', largo: '88', calibre: '2.5 MIL', colorNombre: 'Azul Cielo Especial', colorHex: '#3778c8' } });
  });

  it('5) finalizar genera REV01 desde el mismo formulario y la hoja queda en solo lectura', async () => {
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado({ elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' } });
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    await ancho();
    // El borrador mínimo de la prueba no incluye todos los campos del formulario: se guarda primero (la hoja pide guardar antes de finalizar) y el servidor devuelve lo guardado.
    m.actualizarBorrador.mockImplementation(async (_id, cambios) => guardado({ version: 4, elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' }, especificacion: { datos: cambios.datos ?? {}, incidenciasReconocidas: cambios.incidenciasReconocidas ?? [] } }));
    await user.click(await screen.findByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');
    m.finalizarDocumento.mockResolvedValue(finalizada());
    await user.click(await screen.findByRole('button', { name: 'Finalizar hoja' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    expect(m.finalizarDocumento).toHaveBeenCalledWith('rev-1', 4);
    await screen.findByText(/Finalizada en TEST como/);
    expect(screen.getByTestId('document-panel')).toHaveTextContent(/REV01/);
    expect(screen.getByLabelText('Ancho')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });

  it('6) una hoja finalizada se encuentra de nuevo y se descarga su PDF almacenado', async () => {
    const user = userEvent.setup();
    pagina(true);
    m.historialPorCodigo.mockResolvedValue({ data: [finalizada()] });
    m.descargarPdfFinalizado.mockResolvedValue({ blob: new Blob(['%PDF'], { type: 'application/pdf' }), filename: 'SCHFPMG001_REV01.pdf', sha256: 'c'.repeat(64) });
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Descargar PDF SCHFPMG001_REV01\.pdf/));
    await waitFor(() => expect(m.descargarPdfFinalizado).toHaveBeenCalledWith('rev-fin'));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'SCHFPMG001_REV01.pdf'));
  });

  it('7) crear la siguiente revisión abre un borrador nuevo y conserva REV01 en la lista', async () => {
    const user = userEvent.setup();
    pagina(true);
    const fin = finalizada();
    m.historialPorCodigo.mockResolvedValue({ data: [fin] });
    const borrador = guardado({ id: 'rev-2', basadaEnRevision: 1, revisionPrevista: null, especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', largo: '88' } } });
    m.crearRevisionNueva.mockResolvedValue(borrador);
    const lista = await buscar(user);
    m.historialPorCodigo.mockResolvedValue({ data: [fin, borrador] });                  // el backend ya lista el borrador nuevo y la REV01
    await user.click(await enLista(lista, /Crear nueva revisión de SCHFPMG001 REV01/));
    expect(m.crearRevisionNueva).toHaveBeenCalledWith('doc-1');
    expect((await ancho()).value).toBe('77');
    expect(screen.getByTestId('document-panel')).toHaveTextContent(/Borrador/);
    // Con el formulario abierto la sección de hojas se pliega sola; se vuelve a desplegar para comprobar que REV01 se conserva.
    await user.click(within(screen.getByTestId('hojas-del-codigo')).getByRole('button', { name: /Mostrar hojas de este código/ }));
    await waitFor(() => expect(within(screen.getByTestId('hojas-del-codigo')).getByRole('button', { name: /Ver hoja SCHFPMG001 REV01/ })).toBeInTheDocument());
  });

  it('8) dos variantes del mismo código se muestran por separado (incluida la sin nombre) y no se abre ninguna sola', async () => {
    const user = userEvent.setup();
    pagina(true);
    const sin = guardado({ id: 'rev-a', documentoId: 'doc-a' });
    const dob = guardado({ id: 'rev-b', documentoId: 'doc-b', variante: 'Doblada' });
    m.historialPorCodigo.mockResolvedValue({ data: [sin, dob] });
    const lista = await buscar(user);
    expect(await within(lista).findByRole('group', { name: 'Sin variante' })).toBeInTheDocument();
    expect(within(lista).getByRole('group', { name: 'Variante Doblada' })).toBeInTheDocument();
    expect(within(lista).getAllByRole('button', { name: /Continuar editando SCHFPMG001/ })).toHaveLength(2);
    expect(m.obtenerDocumento).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();
  });

  it('9) permisos: un borrador ajeno se abre en solo lectura; una finalizada ajena no ofrece crear revisión; la finalizada no se edita', async () => {
    const user = userEvent.setup();
    pagina(true);
    const ajeno = guardado({ propio: false, permisos: { ...PERMISOS, editar: false, finalizar: false, asignarRevisor: false, registrarRevision: false } });
    const finAjena = finalizada({ id: 'rev-fin2', documentoId: 'doc-2', variante: 'Otra', propio: false });
    m.historialPorCodigo.mockResolvedValue({ data: [ajeno, finAjena] });
    m.obtenerDocumento.mockResolvedValue(ajeno);
    const lista = await buscar(user);
    expect(within(lista).queryByRole('button', { name: /Crear nueva revisión/ })).not.toBeInTheDocument();
    await user.click(await enLista(lista, /Abrir SCHFPMG001/));
    expect(await ancho()).toBeDisabled();
    expect(screen.getByLabelText('Elaboró')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalizar hoja' })).toBeDisabled();
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
  });

  it('10) «Mis hojas» abre un documento sin escribir su código', async () => {
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado({ codigo: 'OTRO001', especificacion: { datos: { codigo: 'OTRO001', ancho: '55' } } });
    m.listarAbiertos.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    await screen.findByLabelText('Código DCMX a buscar');
    await abrirDesdeMisHojas(user, /Abrir OTRO001/);
    expect((await ancho()).value).toBe('55');
    expect(lookupMock).not.toHaveBeenCalled();                                       // abrir desde «Mis hojas» no consulta BIND
    expect(screen.getByTestId('document-panel')).toHaveTextContent(/OTRO001 · Borrador · v3/);
  });

  it('abrir no cambia la versión ni confirma «Elaboró»; se muestran responsables y revisiones vigentes (dentro del formulario)', async () => {
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado({
      version: 7, revisor: { id: '3', nombre: 'General Tres' },
      confirmaciones: [{ usuario: 'General Tres', correo: 'g3@example.invalid', version: 7, vigente: true, autorrevision: false, comoRevisorAsignado: true, registradaEn: '2026-10-29T10:30:00Z' }],
      especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77' }, incidenciasReconocidas: [{ id: 'A:b', huella: 'h' }] }
    });
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    await ancho();
    expect(screen.getByTestId('document-panel')).toHaveTextContent(/SCHFPMG001 · Borrador · v7/);
    expect(within(screen.getByRole('region', { name: 'Responsables y revisión' })).getByRole('button', { name: 'Confirmar «Elaboró»' })).toBeEnabled();
    expect(screen.getByText(/Revisó: General Tres/)).toBeInTheDocument();
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
    expect(m.crearBorrador).not.toHaveBeenCalled();
  });

  it('una respuesta tardía de un documento abierto ANTES no reemplaza al borrador abierto DESPUÉS', async () => {
    const user = userEvent.setup();
    pagina(true);
    const viejo = guardado({ id: 'rev-A', especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '11' } } });
    const nuevo = guardado({ id: 'rev-B', documentoId: 'doc-b', variante: 'Doblada', especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '22' } } });
    m.historialPorCodigo.mockResolvedValue({ data: [viejo, nuevo] });
    let soltarViejo: (d: DocumentoVista) => void = () => undefined;
    m.obtenerDocumento.mockImplementation((id: string) => id === 'rev-A' ? new Promise<DocumentoVista>((res) => { soltarViejo = res; }) : Promise.resolve(nuevo));
    const lista = await buscar(user);
    const botones = await within(lista).findAllByRole('button', { name: /Continuar editando SCHFPMG001/ });
    // el orden alfabético por variante deja primero «Sin variante» (viejo) y después «Doblada»… se elige por etiqueta accesible
    await user.click(within(lista).getByRole('button', { name: 'Continuar editando SCHFPMG001 Borrador' }));
    await user.click(within(lista).getByRole('button', { name: 'Continuar editando SCHFPMG001 Doblada Borrador' }));
    expect(botones.length).toBe(2);
    await waitFor(() => expect((screen.getByLabelText('Ancho') as HTMLInputElement).value).toBe('22'));
    soltarViejo(viejo);
    await new Promise((r) => setTimeout(r, 50));
    expect((screen.getByLabelText('Ancho') as HTMLInputElement).value).toBe('22');
    expect(screen.getByTestId('document-panel')).toHaveTextContent('Doblada');
  });
  it('en desarrollo (React StrictMode) las acciones del documento terminan: el indicador de carga no queda activo y «Preparar una hoja nueva» sigue disponible', async () => {
    const user = userEvent.setup();
    render(<StrictMode><MemoryRouter><ManufacturingSpecificationPage documentos /></MemoryRouter></StrictMode>);
    const doc = guardado();
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    expect(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' })).toBeEnabled();
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    expect((await ancho()).value).toBe('77');                                           // la respuesta se aplicó (no se ignoró)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();       // el botón no quedó mostrando el indicador de carga
  });
});

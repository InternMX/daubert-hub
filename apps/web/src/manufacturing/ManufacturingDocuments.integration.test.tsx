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
const RETARDO = 60;
const pagina = (documentos?: boolean) => render(<MemoryRouter><ManufacturingSpecificationPage documentos={documentos} retardoAutoguardado={RETARDO} /></MemoryRouter>);
const esperar = (ms = RETARDO * 4) => new Promise((r) => setTimeout(r, ms));
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

  it('1) un código sin hoja: ofrece preparar una nueva con BIND, no crea nada al buscar ni al preparar, y el borrador se guarda solo al confirmar la familia', async () => {
    const user = userEvent.setup();
    pagina(true);
    const lista = await buscar(user);
    expect(m.historialPorCodigo).toHaveBeenCalledWith('SCHFPMG001', expect.anything());
    expect(await within(lista).findByText(/Sin hojas guardadas accesibles/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();                // todavía no hay formulario
    expect(m.crearBorrador).not.toHaveBeenCalled();                                  // consultar BIND no crea documentos
    await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
    // Una hoja PREPARADA (solo en pantalla) se distingue de un borrador guardado en PostgreSQL; el producto se muestra compacto y sin una tarjeta «Estado de la hoja».
    expect(await screen.findByTestId('estado-sin-guardar')).toHaveTextContent('Hoja preparada · sin guardar');
    expect(screen.queryByText('Guardada en PostgreSQL (TEST)')).not.toBeInTheDocument();
    expect(screen.getByTestId('bind-codigo')).toHaveTextContent('SCHFPMG001');
    expect(screen.getByTestId('bind-descripcion')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Estado de la hoja' })).not.toBeInTheDocument();
    await esperar();
    expect(m.crearBorrador).not.toHaveBeenCalled();                                  // preparar y ver la sugerencia no crea nada: falta que el usuario confirme la familia
    m.crearBorrador.mockResolvedValue(guardado());
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();         // solo tras la respuesta del servidor
    expect(m.crearBorrador).toHaveBeenCalledTimes(1);
    const enviado = m.crearBorrador.mock.calls[0]![0];
    expect(enviado).toMatchObject({ codigo: 'SCHFPMG001', familia: 'BOLSA_PLANA_1', bind: { Code: 'SCHFPMG001' } });
    expect(Object.keys(enviado)).not.toEqual(expect.arrayContaining(['usuario', 'estado', 'revision']));
    expect(screen.getByText('Guardada en PostgreSQL (TEST)')).toBeInTheDocument();
    expect(screen.queryByTestId('estado-sin-guardar')).not.toBeInTheDocument();
    expect(screen.getByText(/SCHFPMG001 · Borrador · v3/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Guardar borrador|Guardar cambios/ })).not.toBeInTheDocument();   // sin botón de guardado
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
    expect(m.actualizarBorrador).not.toHaveBeenCalled();                             // abrir no guarda nada
    m.actualizarBorrador.mockResolvedValue(guardado({ version: 4 }));
    const campo = await ancho();
    for (const v of ['9', '99']) fireEvent.change(campo, { target: { value: v } });   // varias teclas seguidas
    expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);                           // una sola petición por pausa de escritura
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
    // El borrador mínimo de la prueba no incluye todos los campos del formulario: «Finalizar y generar PDF» verifica que todo esté persistido (guarda ahora lo pendiente) y solo entonces finaliza.
    m.actualizarBorrador.mockImplementation(async (_id, cambios) => guardado({ version: 4, elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' }, especificacion: { datos: cambios.datos ?? {}, incidenciasReconocidas: cambios.incidenciasReconocidas ?? [] } }));
    m.finalizarDocumento.mockResolvedValue(finalizada());
    await user.click(await screen.findByRole('button', { name: 'Finalizar y generar PDF' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
    expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(m.finalizarDocumento).toHaveBeenCalledWith('rev-1', 4));   // con la versión que devolvió el guardado
    await screen.findByText(/Finalizada en TEST como/);
    expect(screen.getByTestId('document-panel')).toHaveTextContent(/REV01/);
    expect(screen.getByLabelText('Ancho')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Finalizar y generar PDF' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Finalizar y generar PDF' })).toBeDisabled();
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
    render(<StrictMode><MemoryRouter><ManufacturingSpecificationPage documentos retardoAutoguardado={RETARDO} /></MemoryRouter></StrictMode>);
    const doc = guardado();
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    expect(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' })).toBeDisabled();   // ya existe la hoja sin variante: preparar otra exige escribir una variante
    fireEvent.change(within(lista).getByLabelText('Variante (opcional)'), { target: { value: 'Doblada' } });
    expect(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' })).toBeEnabled();
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    expect((await ancho()).value).toBe('77');                                           // la respuesta se aplicó (no se ignoró)
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Finalizar y generar PDF' })).toBeEnabled();       // las acciones no quedaron bloqueadas por un indicador de carga
  });

  describe('guardado automático', () => {
    const abrirBorrador = async (user: ReturnType<typeof userEvent.setup>, doc = guardado()) => {
      pagina(true);
      m.historialPorCodigo.mockResolvedValue({ data: [doc] });
      m.obtenerDocumento.mockResolvedValue(doc);
      const lista = await buscar(user);
      await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
      await ancho();
    };

    it('abrir un borrador y no editarlo NO guarda ni crea versiones, aunque el formulario normalice datos al abrir', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      await esperar();
      expect(m.actualizarBorrador).not.toHaveBeenCalled();
      expect(m.crearBorrador).not.toHaveBeenCalled();
      expect(screen.queryByText('Guardando…')).not.toBeInTheDocument();
    });

    it('nunca dice «Cambios guardados» antes de la confirmación del servidor; muestra «Guardando…» mientras tanto y no pisa respuestas', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      let confirmar: (d: DocumentoVista) => void = () => undefined;
      m.actualizarBorrador.mockImplementation(() => new Promise<DocumentoVista>((res) => { confirmar = res; }));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      expect(await screen.findByText('Guardando…')).toBeInTheDocument();
      expect(screen.queryByText('Cambios guardados')).not.toBeInTheDocument();
      fireEvent.change(await ancho(), { target: { value: '55' } });                   // más ediciones durante el guardado: no se manda otra petición en paralelo
      await esperar();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
      confirmar(guardado({ version: 4 }));
      await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalledTimes(2));      // lo escrito durante el guardado se envía después, con la versión nueva
      expect(m.actualizarBorrador.mock.calls[1]![1]).toMatchObject({ version: 4 });
    });

    it('un error de red se muestra como «Error al guardar», no se reintenta en bucle y «Reintentar» lo resuelve', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      m.actualizarBorrador.mockRejectedValueOnce(new docs.DocumentApiError('NETWORK', 0));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      expect(await screen.findByText('Error al guardar')).toBeInTheDocument();
      await esperar();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);                          // sin reintentos automáticos en bucle
      m.actualizarBorrador.mockResolvedValue(guardado({ version: 4 }));
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
    });

    it('un conflicto de versión (409) no sobrescribe: se detiene, avisa y ofrece recargar la versión vigente', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      m.actualizarBorrador.mockRejectedValue(new docs.DocumentApiError('VERSION_CONFLICT', 409, { versionActual: 5 }));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      expect(await screen.findByText(/Conflicto de versión/)).toBeInTheDocument();
      await esperar();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /Recargar la versión vigente/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Finalizar y generar PDF' })).toBeDisabled();
    });

    it('no confirma «Elaboró» ni envía firmas o identidad en el guardado automático', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      m.actualizarBorrador.mockResolvedValue(guardado({ version: 4 }));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      await screen.findByText('Cambios guardados');
      const cambios = m.actualizarBorrador.mock.calls[0]![1] as unknown as Record<string, unknown>;
      expect(Object.keys(cambios)).not.toEqual(expect.arrayContaining(['elaboroConfirmado']));
      expect(Object.keys(cambios)).not.toEqual(expect.arrayContaining(['elaboroNombre']));
      expect(Object.keys(cambios)).not.toEqual(expect.arrayContaining(['autorizoNombre']));
      expect(screen.getByRole('button', { name: 'Confirmar «Elaboró»' })).toBeEnabled();
    });

    it('al preparar una hoja con variante, se crea una sola vez con esa variante aunque se sigan haciendo ediciones durante la creación', async () => {
      const user = userEvent.setup();
      pagina(true);
      let responder: (d: DocumentoVista) => void = () => undefined;
      m.crearBorrador.mockImplementation(() => new Promise<DocumentoVista>((res) => { responder = res; }));
      const lista = await buscar(user);
      fireEvent.change(within(lista).getByLabelText('Variante (opcional)'), { target: { value: 'Doblada' } });
      await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
      await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
      await waitFor(() => expect(m.crearBorrador).toHaveBeenCalledTimes(1));
      fireEvent.change(await ancho(), { target: { value: '7' } });
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(1);                               // repetir acciones no crea más borradores
      expect(m.crearBorrador.mock.calls[0]![0]).toMatchObject({ codigo: 'SCHFPMG001', variante: 'Doblada' });
      responder(guardado({ variante: 'Doblada' }));
      await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalledTimes(1));      // lo escrito durante la creación se guarda después como actualización
    });

    it('si ya existe la hoja (409 uniforme) se detiene, pide otra variante y reintenta la creación al cambiarla', async () => {
      const user = userEvent.setup();
      pagina(true);
      m.crearBorrador.mockRejectedValueOnce(new docs.DocumentApiError('DOCUMENT_EXISTS', 409));
      const lista = await buscar(user);
      await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
      await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
      expect(await screen.findByText('Ya existe esa hoja')).toBeInTheDocument();
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(1);
      m.crearBorrador.mockResolvedValue(guardado({ variante: 'Extendida' }));
      fireEvent.change(screen.getByLabelText('Variante'), { target: { value: 'Extendida' } });
      expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
      expect(m.crearBorrador).toHaveBeenCalledTimes(2);
      expect(m.crearBorrador.mock.calls[1]![0]).toMatchObject({ variante: 'Extendida' });
    });

    it('un 400 en el PRIMER guardado nombra el campo, no bloquea el guardado: «Reintentar» reenvía los mismos datos y no se duplica el borrador', async () => {
      const user = userEvent.setup();
      pagina(true);
      m.crearBorrador.mockRejectedValueOnce(new docs.DocumentApiError('INVALID_DATA', 400, { fields: ['datos.pesoLb'] }));
      const lista = await buscar(user);
      await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
      await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
      expect(await screen.findByText('Error al guardar')).toBeInTheDocument();
      expect(screen.getByText(/Revisa: pesoLb/)).toBeInTheDocument();                 // identifica el campo rechazado
      expect(screen.queryByText('Cambios guardados')).not.toBeInTheDocument();       // jamás «guardado» sin respuesta exitosa
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(1);                               // sin bucle de reintentos
      const primero = m.crearBorrador.mock.calls[0]![0];
      m.crearBorrador.mockResolvedValue(guardado());
      await user.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
      expect(m.crearBorrador).toHaveBeenCalledTimes(2);
      expect(m.crearBorrador.mock.calls[1]![0]).toEqual(primero);                     // se reenviaron los datos que el usuario ya había capturado
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(2);                               // un solo borrador
    });

    it('tras un 400, corregir el campo reactiva el guardado automático sin pulsar nada', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      m.actualizarBorrador.mockRejectedValueOnce(new docs.DocumentApiError('INVALID_DATA', 400, { fields: ['datos.ancho'] }));
      fireEvent.change(await ancho(), { target: { value: '99999999999999999' } });
      expect(await screen.findByText('Error al guardar')).toBeInTheDocument();
      expect(screen.getByText(/Revisa: ancho/)).toBeInTheDocument();
      await esperar();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
      m.actualizarBorrador.mockResolvedValue(guardado({ version: 4 }));
      fireEvent.change(await ancho(), { target: { value: '13' } });                    // el usuario corrige el valor
      expect(await screen.findByText('Cambios guardados')).toBeInTheDocument();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(2);
      expect(m.actualizarBorrador.mock.calls[1]![1]).toMatchObject({ version: 3, datos: { ancho: '13' } });   // conserva lo capturado antes del error
    });

    it('no se finaliza mientras haya cambios sin persistir: si el guardado previo falla, NO se llama a finalizar', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user, guardado({ elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' } }));
      m.actualizarBorrador.mockRejectedValue(new docs.DocumentApiError('INVALID_DATA', 400, { fields: ['datos.largo'] }));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      await screen.findByText('Error al guardar');
      m.finalizarDocumento.mockResolvedValue(finalizada());
      await user.click(screen.getByRole('button', { name: 'Finalizar y generar PDF' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Finalizar' }));
      await waitFor(() => expect(m.actualizarBorrador.mock.calls.length).toBeGreaterThanOrEqual(2));   // intentó guardar antes de finalizar
      await esperar();
      expect(m.finalizarDocumento).not.toHaveBeenCalled();
      expect(screen.queryByText(/Finalizada en TEST como/)).not.toBeInTheDocument();
    });

    it('con cambios sin persistir advierte antes de cerrar la página; sin cambios pendientes no', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user);
      let confirmar: (d: DocumentoVista) => void = () => undefined;
      m.actualizarBorrador.mockImplementation(() => new Promise<DocumentoVista>((res) => { confirmar = res; }));
      const sinCambios = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(sinCambios);
      expect(sinCambios.defaultPrevented).toBe(false);
      fireEvent.change(await ancho(), { target: { value: '5' } });
      await screen.findByText('Guardando…');
      const conCambios = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(conCambios);
      expect(conCambios.defaultPrevented).toBe(true);
      confirmar(guardado({ version: 4 }));
      await screen.findByText('Cambios guardados');
      await waitFor(() => {                                                          // el aviso se retira en cuanto el servidor confirma
        const guardadas = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(guardadas);
        expect(guardadas.defaultPrevented).toBe(false);
      });
    });
  });
});

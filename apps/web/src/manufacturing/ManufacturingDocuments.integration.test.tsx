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
import { familyConfigs, productoPapel, rolloContinuo, schfpmg001 } from '../test/bindProductFixtures';
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
  finalizarDocumento: vi.fn(), crearRevisionNueva: vi.fn(), descargarPdfFinalizado: vi.fn(), descartarBorrador: vi.fn()
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
    expect(m.crearBorrador).not.toHaveBeenCalled();                                  // preparar y ver la sugerencia no crea nada: falta que el usuario elija la familia
    m.crearBorrador.mockResolvedValue(guardado());
    await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
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
    expect(screen.getByTestId('formato-actual')).toHaveTextContent('Formato: Bolsa Plana 1');
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

  it('5) «Finalizar y generar PDF» está en la sección final; con bloqueos explica qué falta (sin abrir la confirmación ni finalizar) y ofrece ir al campo', async () => {
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado();
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    await ancho();
    const encabezado = screen.getByRole('region', { name: 'Estado y acciones de la hoja' });
    const seccion = screen.getByRole('region', { name: 'Finalizar hoja' });
    expect(within(encabezado).queryByRole('button', { name: /Finalizar y generar PDF|Descartar borrador/ })).not.toBeInTheDocument();   // el encabezado no tiene acciones de finalizar
    expect(screen.getAllByRole('button', { name: 'Finalizar y generar PDF' })).toHaveLength(1);                                         // un solo botón de finalización
    const responsables = screen.getByRole('region', { name: 'Responsables y revisión' });
    expect(responsables.compareDocumentPosition(seccion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();                              // después de los responsables
    await user.click(within(seccion).getByRole('button', { name: 'Finalizar y generar PDF' }));
    const bloqueos = await screen.findByTestId('final-bloqueos');
    expect(bloqueos).toHaveTextContent('Falta confirmar «Elaboró».');
    expect(within(bloqueos).getAllByRole('button', { name: /Ir al campo/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(m.finalizarDocumento).not.toHaveBeenCalled();
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
    expect((await screen.findAllByTestId('incidencia')).length).toBeGreaterThan(0);                   // las observaciones/faltantes quedan junto a sus campos
  });

  it('la validación es automática: no existe «Validar especificación»; el estado de los datos se comprueba solo y nunca dice «Datos completos» sin respuesta vigente', async () => {
    const user = userEvent.setup();
    pagina(true);
    vi.mocked(previewManufacturingSheet).mockImplementation(() => new Promise(() => undefined));   // el servidor aún no responde
    const doc = guardado();
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    await ancho();
    expect(screen.queryByRole('button', { name: 'Validar especificación' })).not.toBeInTheDocument();
    expect(screen.getByTestId('final-datos')).toHaveTextContent('Comprobando datos…');
    expect(screen.queryByText('Datos completos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-reviewed')).not.toBeInTheDocument();                         // no hay «Datos revisados» como si una persona hubiera revisado
  });

  describe('datos obligatorios pendientes: qué falta y dónde', () => {
    async function abrir(user: ReturnType<typeof userEvent.setup>) {
      pagina(true);
      const doc = guardado();
      m.historialPorCodigo.mockResolvedValue({ data: [doc] });
      m.obtenerDocumento.mockResolvedValue(doc);
      const lista = await buscar(user);
      await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
      await ancho();
    }

    it('«Faltan datos obligatorios (N)» se despliega con los nombres claros y «Ir al campo»; el cliente es obligatorio y su rótulo lo dice', async () => {
      const user = userEvent.setup();
      await abrir(user);
      const chip = screen.getByTestId('final-datos');
      await waitFor(() => expect(chip).toHaveTextContent(/Faltan datos obligatorios \(\d+\)/));
      expect(screen.queryByTestId('final-pendientes')).not.toBeInTheDocument();
      await user.click(chip);
      const lista = await screen.findByTestId('final-pendientes');
      expect(within(lista).getByText(/Falta identificar al cliente\./)).toBeInTheDocument();
      expect(within(lista).getAllByRole('button', { name: /Ir al campo/ }).length).toBe(Number(/\((\d+)\)/.exec(chip.textContent ?? '')?.[1]));   // un acceso por cada pendiente contado
      expect(screen.getByLabelText('Cliente (obligatorio para finalizar)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Cliente (opcional)')).not.toBeInTheDocument();
    });

    it('«Ir al campo» desplaza, enfoca y destaca el control; el campo muestra una marca discreta (no el mensaje completo)', async () => {
      const user = userEvent.setup();
      await abrir(user);
      const marcaCliente = within(document.querySelector<HTMLElement>('[data-field="cliente"]') as HTMLElement).getByTestId('campo-pendiente');
      expect(marcaCliente).toHaveTextContent('Pendiente para finalizar');
      expect(screen.queryByText(/Falta identificar al cliente\./)).not.toBeInTheDocument();   // el detalle solo está en «Finalizar hoja»
      await user.click(screen.getByTestId('final-datos'));
      const lista = await screen.findByTestId('final-pendientes');
      await user.click(within(lista).getByRole('button', { name: /Ir al campo: Falta identificar al cliente/ }));
      const entrada = screen.getByLabelText('Cliente (obligatorio para finalizar)');
      await waitFor(() => expect(entrada).toHaveFocus());
      expect((document.querySelector('[data-field="cliente"]') as HTMLElement).style.outline).toContain('solid');
      expect(entrada.getAttribute('aria-describedby') ?? '').toContain(marcaCliente.id);
    });

    it('se actualiza solo al corregir: con el cliente escrito (texto libre, válido en TEST) desaparece el pendiente y su marca, sin resultados obsoletos', async () => {
      const user = userEvent.setup();
      await abrir(user);
      const antes = Number(/\((\d+)\)/.exec(screen.getByTestId('final-datos').textContent ?? '')?.[1]);
      await user.click(screen.getByTestId('final-datos'));
      await screen.findByTestId('final-pendientes');
      m.actualizarBorrador.mockImplementation(async (_id, cambios) => guardado({ version: 4, cliente: { empresaId: null, nombre: (cambios as { cliente?: { nombre?: string } }).cliente?.nombre ?? '', verificado: false } as never }));
      await user.type(screen.getByLabelText('Cliente (obligatorio para finalizar)'), 'Cliente Demo');
      await waitFor(() => expect(within(document.querySelector<HTMLElement>('[data-field="cliente"]') as HTMLElement).queryByTestId('campo-pendiente')).toBeNull());
      const chip = screen.getByTestId('final-datos');
      await waitFor(() => { if (antes > 1) expect(chip).toHaveTextContent(`(${antes - 1})`); else expect(chip).not.toHaveTextContent(/Faltan datos obligatorios/); });
      expect(screen.queryByText(/Falta identificar al cliente\./)).not.toBeInTheDocument();
    });

    it('«Falta confirmar Elaboró» es independiente (no cuenta como dato obligatorio) y su chip lleva a su sección', async () => {
      const user = userEvent.setup();
      await abrir(user);
      const elaboro = screen.getByTestId('final-elaboro');
      expect(elaboro).toHaveTextContent('Falta confirmar «Elaboró»');
      await user.click(screen.getByTestId('final-datos'));
      expect(within(await screen.findByTestId('final-pendientes')).queryByText(/Elaboró/)).not.toBeInTheDocument();
      await user.click(elaboro);
      expect((document.getElementById('responsables-seccion') as HTMLElement).contains(document.activeElement)).toBe(true);
    });
  });

  it('la revisión humana es opcional y secundaria: plegada, sin confirmar sola y dentro de «Responsables y revisión»', async () => {
    const user = userEvent.setup();
    pagina(true);
    const doc = guardado();
    m.historialPorCodigo.mockResolvedValue({ data: [doc] });
    m.obtenerDocumento.mockResolvedValue(doc);
    const lista = await buscar(user);
    await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
    await ancho();
    const responsables = screen.getByRole('region', { name: 'Responsables y revisión' });
    expect(within(responsables).getByText('Revisión del borrador (opcional)')).toBeInTheDocument();
    expect(within(responsables).getByText('No es requisito para finalizar')).toBeInTheDocument();
    expect(within(responsables).queryByRole('button', { name: 'Registrar mi revisión' })).not.toBeInTheDocument();   // plegada por defecto (no accesible)
    await user.click(within(responsables).getByRole('button', { name: /Revisión del borrador \(opcional\)/ }));
    expect(await within(responsables).findByRole('button', { name: 'Registrar mi revisión' })).toBeInTheDocument();
    expect(within(responsables).getByRole('button', { name: 'Confirmar revisión del borrador' })).toBeInTheDocument();
    expect(m.actualizarBorrador).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Revisó:/)).not.toBeInTheDocument();                                   // nada se confirma automáticamente
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
      await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
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
      await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
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
      await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
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

    it('mientras hay un error de guardado la sección final lo indica y no ofrece finalizar como si todo estuviera guardado', async () => {
      const user = userEvent.setup();
      await abrirBorrador(user, guardado({ elaboro: { nombre: 'General Dos', confirmado: true, sugerido: 'General Dos' } }));
      m.actualizarBorrador.mockRejectedValue(new docs.DocumentApiError('INVALID_DATA', 400, { fields: ['datos.largo'] }));
      fireEvent.change(await ancho(), { target: { value: '5' } });
      await screen.findByText('Error al guardar');
      expect(screen.getByTestId('final-guardado')).toHaveTextContent('No se pudo guardar');
      expect(m.finalizarDocumento).not.toHaveBeenCalled();
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

  describe('selección de formato: recomendación contextual, elegir otro formato y descartar', () => {
    const FORMATOS = ['Bolsa Plana 1', 'Hojas', 'Bolsa Fuelle', 'Bolsa Natural', 'Rollo Continuo', 'Termoencogible', 'COEX'];
    const preparar = async (user: ReturnType<typeof userEvent.setup>, lookup = schfpmg001()) => {
      lookupMock.mockResolvedValue(lookup);
      pagina(true);
      const lista = await buscar(user, lookup.producto.Code);
      await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
    };
    const abrir = async (user: ReturnType<typeof userEvent.setup>, doc = guardado()) => {
      pagina(true);
      m.historialPorCodigo.mockResolvedValue({ data: [doc] });
      m.obtenerDocumento.mockResolvedValue(doc);
      const lista = await buscar(user);
      await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
      await ancho();
    };
    const formatoActual = () => screen.getByTestId('formato-actual');
    // Síncrono (fireEvent): el guardado automático pendiente (retardo de prueba 60 ms) no alcanza a enviarse antes de descartar.
    const descartarYa = () => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Finalizar hoja' })).getByRole('button', { name: 'Descartar borrador' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Descartar' }));
    };
    const confirmarDescarte = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(within(screen.getByRole('region', { name: 'Finalizar hoja' })).getByRole('button', { name: 'Descartar borrador' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Descartar' }));
    };

    it('1) producto nuevo con familia recomendada: tarjeta compacta con dos acciones; la recomendación NO está elegida, no hay lista, ni formulario, ni borrador', async () => {
      const user = userEvent.setup();
      await preparar(user);
      const tarjeta = await screen.findByTestId('formato-recomendado');
      expect(tarjeta).toHaveTextContent('Formato recomendado: Bolsa Plana 1');
      expect(within(tarjeta).getByRole('button', { name: 'Usar este formato' })).toBeInTheDocument();
      expect(within(tarjeta).getByRole('button', { name: 'Elegir otro formato' })).toBeInTheDocument();
      expect(screen.queryAllByRole('radio', { name: /Bolsa Plana 1|COEX/ })).toHaveLength(0);       // la lista de siete no es la interfaz principal
      expect(screen.queryByRole('button', { name: 'Confirmar familia' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();                            // el formulario aparece al elegir
      expect(screen.queryByTestId('formato-actual')).not.toBeInTheDocument();
      await esperar();
      expect(m.crearBorrador).not.toHaveBeenCalled();                                              // 10) consultar BIND y ver la recomendación no crea nada
      expect(m.actualizarBorrador).not.toHaveBeenCalled();
    });

    it('2) «Usar este formato» elige la recomendada: línea «Formato: … · Cambiar», formulario, UN borrador y las secciones de responsables y finalizar', async () => {
      const user = userEvent.setup();
      m.crearBorrador.mockResolvedValue(guardado());
      await preparar(user);
      await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
      expect(await ancho()).toBeInTheDocument();
      expect(formatoActual()).toHaveTextContent('Formato: Bolsa Plana 1');
      expect(within(formatoActual().parentElement as HTMLElement).getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
      expect(screen.queryByTestId('formato-recomendado')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('radio', { name: /Bolsa Plana 1/ })).toHaveLength(0);           // la lista queda oculta
      expect(await screen.findByRole('region', { name: 'Finalizar hoja' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Responsables y revisión' })).toBeInTheDocument();
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(1);
      expect(m.crearBorrador.mock.calls[0]![0]).toMatchObject({ familia: 'BOLSA_PLANA_1' });
    });

    it('3) «Elegir otro formato» muestra los siete formatos sin ninguno marcado; al elegir uno comienza con él sin confirmación adicional', async () => {
      const user = userEvent.setup();
      m.crearBorrador.mockResolvedValue(guardado({ familia: 'BOLSA_FUELLE' }));
      await preparar(user);
      await user.click(await screen.findByRole('button', { name: 'Elegir otro formato' }));
      for (const nombre of FORMATOS) expect(screen.getByRole('radio', { name: nombre })).not.toBeChecked();
      expect(screen.getAllByRole('radio')).toHaveLength(7);
      await user.click(screen.getByRole('radio', { name: 'Bolsa Fuelle' }));
      expect(formatoActual()).toHaveTextContent('Formato: Bolsa Fuelle');
      expect(screen.queryAllByRole('radio', { name: 'Bolsa Fuelle' })).toHaveLength(0);
      await waitFor(() => expect(m.crearBorrador).toHaveBeenCalledTimes(1));
      expect(m.crearBorrador.mock.calls[0]![0]).toMatchObject({ familia: 'BOLSA_FUELLE' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('4) sin recomendación confiable: se ofrece directamente la selección de formatos, sin inventar una recomendación ni crear nada', async () => {
      const user = userEvent.setup();
      await preparar(user, productoPapel());
      expect(await screen.findByText(/No hay un formato recomendado para este producto/)).toBeInTheDocument();
      expect(screen.queryByTestId('formato-recomendado')).not.toBeInTheDocument();
      expect(screen.getAllByRole('radio')).toHaveLength(7);
      for (const nombre of FORMATOS) expect(screen.getByRole('radio', { name: nombre })).not.toBeChecked();
      expect(screen.queryByLabelText('Ancho')).not.toBeInTheDocument();
      await esperar();
      expect(m.crearBorrador).not.toHaveBeenCalled();
    });

    it('5) abrir un borrador guardado muestra su familia real, sin tarjeta de recomendación, sin pedir elegir y sin escribir nada (ni al ver «Cambiar»)', async () => {
      const user = userEvent.setup();
      await abrir(user);
      expect(formatoActual()).toHaveTextContent('Formato: Bolsa Plana 1');
      expect(screen.queryByTestId('formato-recomendado')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Usar este formato' })).not.toBeInTheDocument();
      await esperar();
      expect(m.actualizarBorrador).not.toHaveBeenCalled();
      expect(m.crearBorrador).not.toHaveBeenCalled();
    });

    it('6) cambiar de formato antes de guardar: se crea una sola hoja, con el último formato', async () => {
      const user = userEvent.setup();
      m.crearBorrador.mockResolvedValue(guardado({ familia: 'BOLSA_FUELLE' }));
      await preparar(user);
      fireEvent.click(await screen.findByRole('button', { name: 'Usar este formato' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Bolsa Fuelle' }));
      await waitFor(() => expect(m.crearBorrador).toHaveBeenCalledTimes(1));
      await esperar();
      expect(m.crearBorrador).toHaveBeenCalledTimes(1);
      expect(m.crearBorrador.mock.calls[0]![0]).toMatchObject({ familia: 'BOLSA_FUELLE' });
    });

    it('7) cambiar de formato DESPUÉS de guardar pide confirmación: conservar no escribe nada; cambiar actualiza el borrador con el nuevo formato', async () => {
      const user = userEvent.setup();
      await abrir(user);
      await user.click(screen.getByRole('button', { name: 'Cambiar' }));
      await user.click(screen.getByRole('radio', { name: 'Bolsa Fuelle' }));
      const dialogo = await screen.findByRole('dialog');
      expect(dialogo).toHaveTextContent(/ya está guardada como Bolsa Plana 1/);
      await user.click(within(dialogo).getByRole('button', { name: 'Conservar la familia actual' }));
      await cerrado();
      expect(formatoActual()).toHaveTextContent('Formato: Bolsa Plana 1');
      await esperar();
      expect(m.actualizarBorrador).not.toHaveBeenCalled();
      m.actualizarBorrador.mockResolvedValue(guardado({ familia: 'BOLSA_FUELLE', version: 4 }));
      await user.click(screen.getByRole('button', { name: 'Cambiar' }));
      await user.click(screen.getByRole('radio', { name: 'Bolsa Fuelle' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cambiar familia' }));
      await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalledTimes(1));
      expect(m.actualizarBorrador.mock.calls[0]![1]).toMatchObject({ version: 3, familia: 'BOLSA_FUELLE' });
    });

    it('8) COEX: se puede elegir de la lista y conserva su selector de variante azul/verde', async () => {
      const user = userEvent.setup();
      m.crearBorrador.mockResolvedValue(guardado({ familia: 'COEX' }));
      await preparar(user);
      await user.click(await screen.findByRole('button', { name: 'Elegir otro formato' }));
      await user.click(screen.getByRole('radio', { name: 'COEX' }));
      expect(formatoActual()).toHaveTextContent('Formato: COEX');
      expect(await screen.findByLabelText('Variante COEX')).toBeInTheDocument();
    });

    it('9) Rollo Continuo recomendado conserva sus modalidades (Extendida sigue no autorizada) al usar el formato', async () => {
      const user = userEvent.setup();
      m.crearBorrador.mockResolvedValue(guardado({ familia: 'ROLLO_CONTINUO' }));
      await preparar(user, rolloContinuo());
      expect(await screen.findByTestId('formato-recomendado')).toHaveTextContent('Formato recomendado: Rollo Continuo');
      await user.click(screen.getByRole('button', { name: 'Usar este formato' }));
      expect(formatoActual()).toHaveTextContent('Formato: Rollo Continuo');
      expect(document.querySelector('[data-field="modalidad"]')).not.toBeNull();
      expect(screen.getByRole('radio', { name: /Extendida/ })).toBeDisabled();                      // no autorizada: se muestra deshabilitada (regla existente)
    });

    it('descartar: cierra el formulario, limpia el documento activo, avisa, recarga «Hojas de este código» y «Mis hojas» y cancela el guardado automático pendiente', async () => {
      const user = userEvent.setup();
      await abrir(user);
      m.descartarBorrador.mockResolvedValue(guardado({ estado: 'DESCARTADO' as never }));
      const consultas = m.historialPorCodigo.mock.calls.length;
      m.historialPorCodigo.mockResolvedValue({ data: [] });
      fireEvent.change(await ancho(), { target: { value: '5' } });                      // guardado automático pendiente (aún no se envió)
      descartarYa();
      expect(await screen.findByTestId('mensaje-pagina')).toHaveTextContent('Borrador descartado.');
      expect(m.descartarBorrador).toHaveBeenCalledWith('rev-1', 3);
      expect(screen.queryByTestId('formulario-documento')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Finalizar hoja' })).not.toBeInTheDocument();
      await waitFor(() => expect(m.historialPorCodigo.mock.calls.length).toBeGreaterThan(consultas));
      await esperar();
      expect(m.actualizarBorrador).not.toHaveBeenCalled();                              // el guardado pendiente quedó anulado
      expect(screen.getByRole('button', { name: 'Preparar una hoja nueva' })).toBeInTheDocument();   // estado de preparación coherente
      const antes = m.listarAbiertos.mock.calls.length;
      await user.click(screen.getByRole('button', { name: 'Mis hojas' }));
      await waitFor(() => expect(m.listarAbiertos.mock.calls.length).toBeGreaterThan(antes));
    });

    it('con un guardado en curso no se puede descartar (el botón espera) y, al terminar, se descarta la versión vigente sin que nada restaure la hoja', async () => {
      const user = userEvent.setup();
      await abrir(user);
      let responder: (d: DocumentoVista) => void = () => undefined;
      m.actualizarBorrador.mockImplementation(() => new Promise<DocumentoVista>((res) => { responder = res; }));
      m.descartarBorrador.mockResolvedValue(guardado({ estado: 'DESCARTADO' as never, version: 4 }));
      fireEvent.change(await ancho(), { target: { value: '6' } });
      await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalledTimes(1));
      const boton = within(screen.getByRole('region', { name: 'Finalizar hoja' })).getByRole('button', { name: 'Descartar borrador' });
      expect(boton).toBeDisabled();
      responder(guardado({ version: 4 }));
      await waitFor(() => expect(boton).toBeEnabled());
      await confirmarDescarte(user);
      await waitFor(() => expect(m.descartarBorrador).toHaveBeenCalledWith('rev-1', 4));
      expect(await screen.findByTestId('mensaje-pagina')).toBeInTheDocument();
      await esperar();
      expect(screen.queryByTestId('formulario-documento')).not.toBeInTheDocument();
      expect(m.actualizarBorrador).toHaveBeenCalledTimes(1);
    });

    it('si el servidor rechaza el descarte, la hoja sigue abierta y editable con el error', async () => {
      const user = userEvent.setup();
      await abrir(user);
      m.descartarBorrador.mockRejectedValue(new docs.DocumentApiError('NETWORK', 0, {}));
      await confirmarDescarte(user);
      await waitFor(() => expect(m.descartarBorrador).toHaveBeenCalledTimes(1));
      await cerrado();
      expect(screen.getByTestId('formulario-documento')).toBeInTheDocument();
      expect(screen.queryByTestId('mensaje-pagina')).not.toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Finalizar hoja' })).toBeInTheDocument();
    });
  });

  describe('concentración del color: recorrido real guardar → reabrir', () => {
    // El «servidor» simulado guarda lo que recibe (datos, procedencia, bind) y lo devuelve como la copia guardada.
    const eco = (cuerpo: Record<string, unknown>, version: number): DocumentoVista => guardado({
      version, familia: cuerpo.familia as DocumentoVista['familia'],
      especificacion: { datos: cuerpo.datos as Record<string, string>, procedencia: cuerpo.procedencia as Record<string, string>, bind: cuerpo.bind as never }
    });

    it('2 % → 3 %: se envía y se guarda 3, y al reabrir desde «Mis hojas» conserva 3 %, «Editado por el usuario», el texto «AL 3%» y la resina VCI; abrir no guarda', async () => {
      const user = userEvent.setup();
      let ultimo: DocumentoVista = guardado();
      m.crearBorrador.mockImplementation(async (c) => { ultimo = eco(c as never, 1); return ultimo; });
      m.actualizarBorrador.mockImplementation(async (_id, c) => { ultimo = eco({ familia: ultimo.familia, ...(c as object) } as never, ultimo.version + 1); return ultimo; });
      const vista = pagina(true);
      const lista = await buscar(user);
      await user.click(within(lista).getByRole('button', { name: 'Preparar una hoja nueva' }));
      await user.click(await screen.findByRole('button', { name: 'Usar este formato' }));
      await screen.findByText('Cambios guardados');
      const conc = await screen.findByLabelText('Concentración del color (%)') as HTMLInputElement;
      expect(conc.value).toBe('2');
      const resina = (screen.getByLabelText('Resina VCI') as HTMLInputElement).value;
      fireEvent.change(conc, { target: { value: '3' } });
      await waitFor(() => expect(m.actualizarBorrador).toHaveBeenCalledTimes(1));
      const enviado = m.actualizarBorrador.mock.calls[0]![1] as unknown as { datos: Record<string, string>; procedencia: Record<string, string> };
      expect(enviado.datos).toMatchObject({ colorConcentracion: '3', colorNombre: 'DAUBERT AZUL AL 3%' });
      expect(enviado.procedencia.colorConcentracion).toBe('USUARIO');
      expect(enviado.datos.resinaVci).toBe(resina);
      await screen.findByText('Cambios guardados');
      vista.unmount();

      m.listarAbiertos.mockResolvedValue({ data: [ultimo] });
      m.obtenerDocumento.mockResolvedValue(ultimo);
      const antes = m.actualizarBorrador.mock.calls.length;
      pagina(true);
      await abrirDesdeMisHojas(user, /Abrir SCHFPMG001/);
      const reabierta = await screen.findByLabelText('Concentración del color (%)') as HTMLInputElement;
      expect(reabierta.value).toBe('3');
      expect(within(document.querySelector<HTMLElement>('[data-field="colorConcentracion"]') as HTMLElement).getByText('Editado por el usuario')).toBeInTheDocument();
      expect((screen.getByLabelText('Texto del color en el documento') as HTMLInputElement).value).toBe('DAUBERT AZUL AL 3%');
      expect((screen.getByLabelText('Resina VCI') as HTMLInputElement).value).toBe(resina);
      await esperar();
      expect(m.actualizarBorrador.mock.calls.length).toBe(antes);                      // abrir no guarda
    });

    it('un documento anterior sin el campo se abre con la concentración vacía (sin inventar 2 % ni 3 % a partir del texto) y sin marcar cambios', async () => {
      const user = userEvent.setup();
      const antiguo = guardado({ especificacion: { datos: { codigo: 'SCHFPMG001', ancho: '77', largo: '88', colorNombre: 'DAUBERT AZUL AL 3%', colorHex: '#538DD5' } } });
      m.historialPorCodigo.mockResolvedValue({ data: [antiguo] });
      m.obtenerDocumento.mockResolvedValue(antiguo);
      pagina(true);
      const lista = await buscar(user);
      await user.click(await enLista(lista, /Continuar editando SCHFPMG001/));
      expect(((await screen.findByLabelText('Concentración del color (%)')) as HTMLInputElement).value).toBe('');
      expect((screen.getByLabelText('Texto del color en el documento') as HTMLInputElement).value).toBe('DAUBERT AZUL AL 3%');
      await esperar();
      expect(m.actualizarBorrador).not.toHaveBeenCalled();
    });
  });

});

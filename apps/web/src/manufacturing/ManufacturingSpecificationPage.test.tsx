import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { listManufacturingFamilies } from '../services/manufacturingFamilies';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { bolsaFuelle, bolsaNatural, casoB, coexAzul, coexSinColor, deepFreeze, familyConfigs, productoPapel, resinaContradictoria, resinaCorroborada, resinaInferidaDeCode, rolloContinuo, schfpmg001, termoencogible } from '../test/bindProductFixtures';
import { ManufacturingSpecificationPage } from './ManufacturingSpecificationPage';
import { localIsoDate } from './specificationForm';

vi.mock('../services/bindProducts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindProducts')>()), lookupBindProductByCode: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));
vi.mock('../services/manufacturingFamilies', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/manufacturingFamilies')>()), listManufacturingFamilies: vi.fn() }));

vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn() }));
const previewMock = vi.mocked(previewManufacturingSheet);
const lookupMock = vi.mocked(lookupBindProductByCode);
const listClientsMock = vi.mocked(listClients);
const familiesMock = vi.mocked(listManufacturingFamilies);

function renderPage() { return render(<MemoryRouter><ManufacturingSpecificationPage /></MemoryRouter>); }

async function buscar(user: ReturnType<typeof userEvent.setup>, code = 'SCHFPMG001') {
  fireEvent.change(screen.getByLabelText('Código DCMX a buscar'), { target: { value: code } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
}

const campo = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const frameOf = (label: string) => campo(label).closest('div.MuiBox-root') as HTMLElement;
const CLIENTE = 'Cliente (opcional)';
const clienteCatalogo = { id: 'c-1', commercialName: 'Schneider Electric', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO' as const, notes: null, roles: ['CLIENTE'], fiscal: null };

async function elegirCliente(user: ReturnType<typeof userEvent.setup>) {
  listClientsMock.mockResolvedValue({ data: [clienteCatalogo], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } });
  await user.type(campo(CLIENTE), 'Schn');
  await user.click(await screen.findByRole('option', { name: 'Schneider Electric' }));
}

beforeEach(() => {
  familiesMock.mockResolvedValue(familyConfigs);
  previewMock.mockImplementation(async (familia, datos) => ({
    html: `<p>${familia} ancho=${datos.ancho} largo=${datos.largo} cantidad=${datos.cantidad} calibre=${datos.calibre} etiqueta=${datos.etiqueta} color=${datos.colorNombre}|${datos.colorHex} cliente=${datos.cliente} fuelles=${datos.fuelleDerecho}/${datos.fuelleIzquierdo}</p>`,
    familia, borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: datos.cliente ? [] : ['Cliente'], bloqueado: null
  }));
  listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
});
afterEach(() => { vi.clearAllMocks(); });

// El formulario completo (MUI + vista previa con debounce) es costoso de renderizar: con la suite completa en paralelo y cobertura, 5 s no alcanzan.
describe('ManufacturingSpecificationPage', { timeout: 30_000 }, () => {
  it('una contradicción exige reconocerla antes de confirmar la revisión; editar los datos que la originan invalida el reconocimiento', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    previewMock.mockResolvedValue({ html: '<p>Borrador</p>', familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: ['Cliente'], bloqueado: null,
      incidencias: [{ id: 'COLOR_VARIANTE:colorNombre', codigo: 'COLOR_VARIANTE', nivel: 'CONTRADICCION', campos: ['colorNombre'], seccion: 'color', mensaje: 'La hoja usa AZUL, pero BIND menciona COLOR VERDE.', origen: 'TITLE', afectaVistaPrevia: false, reconocible: true }] });
    renderPage();
    await buscar(user);
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    const review = await screen.findByRole('button', { name: 'Confirmar revisión del borrador' });
    const color = await screen.findByTestId('incidencia');
    expect(color).toHaveTextContent('BIND menciona COLOR VERDE');
    expect(within(frameOf('Texto del color en el documento')).getByTestId('incidencia')).toBe(color);                  // se muestra en el campo, una sola vez
    expect(screen.getByTestId('review-blocked-hint')).toHaveTextContent('contradicciones técnicas (1)');
    expect(review).toBeDisabled();
    await user.click(within(color).getByRole('button', { name: 'Reconocer esta diferencia' }));
    expect(screen.queryByTestId('review-blocked-hint')).not.toBeInTheDocument();
    await waitFor(() => expect(review).toBeEnabled());
    expect(screen.getByTestId('status-reviewed')).toHaveTextContent('pendientes de revisión');
    await user.click(review);
    expect(screen.getByTestId('status-reviewed')).toHaveTextContent('Datos revisados para este borrador');
    // editar los datos que originaron la contradicción: el reconocimiento caduca y la revisión también
    fireEvent.change(campo('Texto del color en el documento'), { target: { value: 'VERDE' } });
    expect(screen.getByTestId('status-reviewed')).toHaveTextContent('pendientes de revisión');
    expect(await screen.findByTestId('review-blocked-hint')).toBeInTheDocument();                  // tras la respuesta del backend para los datos nuevos
    expect(screen.getByTestId('status-emission')).toHaveTextContent('No apto');
    expect(campo('Descripción').value).toBe(schfpmg001().producto.Title);
  });
  it('muestra el buscador y no consulta nada hasta que el usuario lo pide', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Especificación de manufactura' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeDisabled();
    expect(lookupMock).not.toHaveBeenCalled();
    await waitFor(() => expect(familiesMock).toHaveBeenCalled());
  });

  it('si la configuración de familias no carga, lo informa y no permite buscar', async () => {
    familiesMock.mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByText(/No se pudo cargar la configuración de las familias/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Código DCMX a buscar'), { target: { value: 'SCHFPMG001' } });
    expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeDisabled();
  });

  it('flujo SCHFPMG001: precarga BIND, sugiere familia, PMG AL 3%, Daubert Azul, fecha y etiqueta con su procedencia; ofrece las familias del backend', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(deepFreeze(schfpmg001()));
    renderPage();
    await buscar(user);
    expect(lookupMock).toHaveBeenCalledWith('SCHFPMG001', expect.any(AbortSignal));
    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(within(panel).getByText('Solo lectura')).toBeInTheDocument();

    expect(campo('Código DCMX').value).toBe('SCHFPMG001');
    expect(campo('Ancho').value).toBe('13');
    expect(campo('Calibre').value).toBe('3 MIL');
    expect(campo('Resina VCI').value).toBe('PMG AL 3%');
    expect(within(frameOf('Resina VCI')).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(campo('Fecha de emisión de la hoja').value).toBe(localIsoDate());
    expect(campo('Etiqueta').value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(campo('Texto del color en el documento').value).toBe('DAUBERT AZUL AL 2%');
    expect(screen.getByTestId('color-hex-readonly')).toHaveTextContent('#538DD5');
    expect(within(frameOf('Ancho')).getByText('Recuperado de BIND')).toBeInTheDocument();
    // las familias disponibles vienen de la configuración del backend
    for (const familia of familyConfigs) expect(screen.getByRole('radio', { name: familia.nombre })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).toBeChecked();
    expect(screen.getByTestId('family-chip')).toHaveTextContent('Sugerida por el sistema (provisional)');
    // una bolsa plana no muestra campos de fuelles ni modalidad
    expect(screen.queryByLabelText('Fuelle derecho')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Doblada' })).not.toBeInTheDocument();
  });

  it('cliente vacío en la demostración: datos técnicos suficientes y borrador visible; el pendiente para una emisión futura es claro y el cliente sigue siendo requisito', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByTestId('status-preview')).toHaveTextContent('Borrador previsualizable');
    expect(screen.getByTestId('status-technical')).toHaveTextContent('Datos técnicos suficientes');
    expect(screen.getByTestId('status-emission')).toHaveTextContent('No apto para emisión futura');
    expect(screen.getByTestId('status-approval')).toHaveTextContent('fuera de alcance');
    expect(screen.getByTestId('resumen-INFORMACION')).toHaveTextContent('informativa');                 // el cliente es informativo: se cuenta una vez en la revisión
    expect(screen.getByText(/Puede quedar vacío en la demostración/)).toBeInTheDocument();             // y se explica donde se captura
    expect(screen.queryByTestId('emission-pending-list')).not.toBeInTheDocument();
    await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(screen.queryByTestId('preview-emission-pending')).not.toBeInTheDocument();                    // el cliente no afecta la representación: la vista previa no lo repite

    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Datos técnicos suficientes para la vista previa/)).toBeInTheDocument();
    expect(screen.queryByText(/apto para una emisión futura/)).not.toBeInTheDocument();
  });

  it('texto libre no vincula al cliente; elegirlo del catálogo y confirmar la familia lo vuelve apto para una emisión futura', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo(CLIENTE).value).toBe('');
    await user.type(campo(CLIENTE), 'Nuevo Cliente SA');
    expect(within(frameOf(CLIENTE)).getByText('Texto libre: no vinculado al catálogo')).toBeInTheDocument();
    expect(screen.getByTestId('resumen-INFORMACION')).toBeInTheDocument();
    await user.clear(campo(CLIENTE));
    await elegirCliente(user);
    expect(within(frameOf(CLIENTE)).getByText('Cliente del catálogo (confirmado)')).toBeInTheDocument();
    expect(screen.getByTestId('status-emission')).toHaveTextContent('No apto para emisión futura');            // la familia sigue siendo una sugerencia
    await user.click(screen.getByRole('button', { name: 'Confirmar familia' }));
    expect(screen.getByTestId('status-emission')).toHaveTextContent('No apto para emisión futura');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar revisión del borrador' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Confirmar revisión del borrador' }));
    expect(screen.getByTestId('status-emission')).toHaveTextContent('Apto para emisión futura');
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/apto para una emisión futura/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no se guarda ni se emite ninguna hoja/)).toBeInTheDocument();
  });

  it('Bolsa Fuelle sugerida con tres medidas: ancho, fuelle total y mitades derivadas con su procedencia; la unidad queda pendiente', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(bolsaFuelle());
    renderPage();
    await buscar(user, 'FUELLE61');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'Bolsa Fuelle' })).toBeChecked();
    expect(campo('Ancho').value).toBe('61');
    expect(campo('Fuelle total').value).toBe('48');
    expect(campo('Fuelle derecho').value).toBe('24');
    expect(campo('Fuelle izquierdo').value).toBe('24');
    expect(campo('Largo').value).toBe('70.9');
    expect(campo('Calibre').value).toBe('2.7');
    expect(within(frameOf('Fuelle derecho')).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(within(frameOf('Unidad de las medidas')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    // editar el fuelle total recalcula las mitades derivadas
    fireEvent.change(campo('Fuelle total'), { target: { value: '50' } });
    expect(campo('Fuelle derecho').value).toBe('25');
    expect(campo('Fuelle izquierdo').value).toBe('25');
    // editar un fuelle lo marca como del usuario
    fireEvent.change(campo('Fuelle derecho'), { target: { value: '26' } });
    expect(within(frameOf('Fuelle derecho')).getByText('Editado por el usuario')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Fuelle').getAttribute('srcdoc')).toContain('fuelles=26/25'), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![0]).toBe('BOLSA_FUELLE');
    expect(previewMock.mock.calls.at(-1)![1]).toHaveProperty('fuelleTotal', '50'); // auxiliar de coherencia: no se imprime
  });

  it('Bolsa Natural: composición fija (no editable), sin formulación VCI automática y color natural por defecto', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(bolsaNatural());
    renderPage();
    await buscar(user, 'NAT61');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'Bolsa Natural' })).toBeChecked();
    expect(screen.getByTestId('family-note')).toHaveTextContent(/realmente una bolsa natural/);
    expect(screen.getByText(/Composición \(fija en esta familia\)/)).toBeInTheDocument();
    for (const radio of [screen.getByRole('radio', { name: 'Natural' })]) { expect(radio).toBeChecked(); expect(radio).toBeDisabled(); }
    expect(screen.queryByRole('radio', { name: 'CP5000' })).not.toBeInTheDocument();
    expect(campo('Resina VCI').value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Confirmar familia' }));
    expect(screen.getByTestId('family-chip')).toHaveTextContent('Familia elegida por el usuario');
  });

  it('cambiar de familia conserva lo compatible, avisa lo incompatible y no lo envía a la vista previa', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(bolsaFuelle());
    renderPage();
    await buscar(user, 'FUELLE61');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    fireEvent.change(campo('Calibre'), { target: { value: '300' } });
    fireEvent.change(campo('Fuelle derecho'), { target: { value: '26' } });
    await user.click(screen.getByRole('radio', { name: 'Bolsa Plana 1' }));
    expect(screen.queryByLabelText('Fuelle derecho')).not.toBeInTheDocument();
    expect(campo('Calibre').value).toBe('300');                           // compatible: se conserva
    expect((await screen.findByTestId('incidencias-familia')).textContent).toMatch(/Fuelle derecho \(26\) no aplica a Bolsa Plana 1/);
    await waitFor(() => expect(previewMock.mock.calls.at(-1)![0]).toBe('BOLSA_PLANA_1'), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('fuelleDerecho');
    await user.click(screen.getByRole('radio', { name: 'Bolsa Fuelle' }));
    expect(campo('Fuelle derecho').value).toBe('26');                     // al volver, el dato sigue ahí
  });

  it('familia sin información suficiente: queda pendiente y se explica el motivo', async () => {
    const user = userEvent.setup();
    const base = schfpmg001();
    lookupMock.mockResolvedValue({ ...base, familiaSugerida: [], sugerencias: { ...base.sugerencias, familia: { valor: null, motivo: 'Hay indicios de otra familia: elige manualmente.', incompatibles: [] } } });
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Familia de manufactura' });
    for (const familia of familyConfigs) expect(screen.getByRole('radio', { name: familia.nombre })).not.toBeChecked();
    expect(screen.getByTestId('family-note')).toHaveTextContent(/elige manualmente/);
    expect(screen.getByTestId('status-preview')).toHaveTextContent('falta la familia');
    expect(screen.queryByRole('region', { name: /Datos de/ })).not.toBeInTheDocument();
  });

  it('corregir un valor lo marca como editado SIN alterar el producto original de BIND, y puede restaurarse', async () => {
    const user = userEvent.setup();
    const original = deepFreeze(schfpmg001());
    lookupMock.mockResolvedValue(original);
    renderPage();
    await buscar(user);
    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    const antes = panel.textContent;
    await user.clear(campo('Ancho'));
    await user.type(campo('Ancho'), '14');
    expect(within(frameOf('Ancho')).getByText('Editado por el usuario')).toBeInTheDocument();
    expect(within(frameOf('Ancho')).getByText('Valor de BIND: 13')).toBeInTheDocument();
    expect(panel.textContent).toBe(antes);
    expect(original.interpretacion.campos.ancho.valor).toBe(13);
    await user.click(screen.getByRole('button', { name: 'Restaurar Ancho' }));
    expect(campo('Ancho').value).toBe('13');
  });

  it('Hojas: muestra la modalidad (Doblada y Extendida habilitadas) y la exige; advierte la familia incompatible con una bolsa', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    expect(screen.getByRole('region', { name: 'Datos de Hojas' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Doblada' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeEnabled();
    expect(screen.getByTestId('resumen-ERROR')).toBeInTheDocument();                                     // faltan datos: se cuenta en la revisión; el campo lo marca al validar
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta hoja doblada o extendida/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Extendida' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Datos técnicos suficientes para la vista previa/)).toBeInTheDocument();
    expect((await screen.findByTestId('incidencias-familia')).textContent).toMatch(/Familia incompatible con los datos de BIND: BIND describe una bolsa, no una hoja/);
  });

  it('caso B: conserva CAL.200 literal, sin exigir unidad; los pendientes reales siguen marcados', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(casoB());
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Calibre').value).toBe('200');
    expect(screen.queryByLabelText('Calibre (unidad)')).not.toBeInTheDocument();
    expect(within(frameOf('Peso (lb)')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos técnicos/)).toBeInTheDocument();
    expect(screen.getByText(/Falta peso \(lb\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Falta calibre/i)).not.toBeInTheDocument();
  });

  it('color unificado: un solo selector actualiza el texto y el dibujo; Otro valida nombre y #RRGGBB con muestra visual', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Color' });
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(83, 141, 213)' });
    await user.click(screen.getByRole('combobox', { name: /^Color/ }));
    await user.click(await screen.findByRole('option', { name: /^Verde/ }));
    expect(campo('Texto del color en el documento').value).toBe('VERDE');
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(0, 176, 80)' });
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('color=VERDE|#00B050'), { timeout: 3000 });
    await user.click(screen.getByRole('combobox', { name: /^Color/ }));
    await user.click(await screen.findByRole('option', { name: /^Otro/ }));
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#GG0000' } });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Escribe el nombre del color/)).toBeInTheDocument();
    expect(screen.getByText(/El color debe tener el formato #RRGGBB/)).toBeInTheDocument();
    fireEvent.change(campo('Texto del color en el documento'), { target: { value: 'ROJO' } });
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#C00000' } });
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(192, 0, 0)' });
  });

  it('etiqueta: se edita independiente de la descripción, no se pierde al cambiar otros campos y se restaura al título de BIND', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    const restaurar = screen.getByRole('button', { name: 'Restaurar título de BIND' });
    expect(restaurar).toBeDisabled();
    fireEvent.change(campo('Etiqueta'), { target: { value: 'ETIQUETA PERSONALIZADA' } });
    fireEvent.change(campo('Descripción'), { target: { value: 'Descripción corregida' } });
    fireEvent.change(campo('Ancho'), { target: { value: '15' } });
    expect(campo('Etiqueta').value).toBe('ETIQUETA PERSONALIZADA');
    await user.click(restaurar);
    expect(campo('Etiqueta').value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(campo('Descripción').value).toBe('Descripción corregida');
  });

  it('vista previa incompleta o bloqueada: advierte, marca el borrador como incompleto y no muestra un documento engañoso', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    previewMock.mockResolvedValueOnce({ html: '<p>x</p>', familia: 'BOLSA_PLANA_1', borrador: true, firmas: 'SIN_FIRMA', completo: false, faltantes: ['Peso (lb)'], advertencias: [], pendientesEmision: ['Cliente'], bloqueado: null });
    renderPage();
    await buscar(user);
    await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(screen.getByTestId('preview-incomplete')).toHaveTextContent('Datos técnicos incompletos');
    expect(screen.getByText(/la representación es incompleta/)).toBeInTheDocument();
    expect(screen.getAllByText('BORRADOR INCOMPLETO · FALTAN DATOS').length).toBeGreaterThan(0);

    previewMock.mockResolvedValue({ html: '', familia: 'HOJA_PAQ', borrador: true, firmas: 'SIN_FIRMA', completo: false, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: 'La modalidad Extendida de Hojas no está autorizada.' });
    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    expect(await screen.findByTestId('preview-blocked', undefined, { timeout: 3000 })).toHaveTextContent(/no está autorizada/);
    expect(screen.queryByTitle('Vista previa de la hoja Hojas')).not.toBeInTheDocument();
  });

  it('estados: cargando, no encontrado, error de BIND y código no válido', async () => {
    const user = userEvent.setup();
    let resolver: (v: ReturnType<typeof schfpmg001>) => void = () => undefined;
    lookupMock.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve; }));
    renderPage();
    await buscar(user);
    expect(await screen.findByText('Consultando BIND…')).toBeInTheDocument();
    resolver(schfpmg001());
    await screen.findByRole('region', { name: 'Producto en BIND' });
    lookupMock.mockRejectedValueOnce(new BindProductApiError('NOT_FOUND', 404));
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText('No se encontró un producto con ese código en BIND.')).toBeInTheDocument();
    lookupMock.mockRejectedValueOnce(new BindProductApiError('BIND_UNAVAILABLE', 502));
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText('No se pudo consultar BIND en este momento.')).toBeInTheDocument();
    fireEvent.change(campo('Código DCMX a buscar'), { target: { value: "X' or 1" } });
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText(/El código no es válido/)).toBeInTheDocument();
    expect(lookupMock).toHaveBeenCalledTimes(3);
  });

  it('una nueva búsqueda inicia un borrador nuevo y descarta las ediciones', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValueOnce(schfpmg001()).mockResolvedValueOnce(casoB());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    fireEvent.change(campo('Ancho'), { target: { value: '99' } });
    fireEvent.change(campo('Código DCMX a buscar'), { target: { value: 'PRUEBA58X43' } });
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    await waitFor(() => expect(campo('Ancho').value).toBe('58'));
    expect(screen.queryByText('Editado por el usuario')).not.toBeInTheDocument();
  });

  it('vista previa: usa la plantilla de la familia, refleja correcciones y calibre literal sin alterar el producto de BIND', async () => {
    const user = userEvent.setup();
    const original = deepFreeze(casoB());
    lookupMock.mockResolvedValue(original);
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    const antes = panel.textContent;
    const frame = await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(frame.getAttribute('srcdoc')).toContain('calibre=200 ');
    expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ codigo: 'PRUEBA58X43', composicion: 'PMG', calibre: '200', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', resinaVci: 'PMG AL 3%' });
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('modalidad');
    fireEvent.change(campo('Ancho'), { target: { value: '60' } });
    fireEvent.change(campo('Calibre'), { target: { value: '2 MIL' } });
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('ancho=60 largo=43 cantidad=100 calibre=2 MIL'), { timeout: 3000 });
    expect(panel.textContent).toBe(antes);
    expect(original.interpretacion.campos.calibre.valor?.valorOriginal).toBe('200');
    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Hojas').getAttribute('srcdoc')).toContain('HOJA_PAQ'), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![1]).toHaveProperty('modalidad');
    expect(screen.getAllByText('BORRADOR · SIN APROBAR').length).toBeGreaterThan(0);
  });
});

describe('ManufacturingSpecificationPage · Rollo Continuo y Termoencogible', { timeout: 30_000 }, () => {
  it('Rollo Continuo: ancho del rollo independiente, sin cantidad y Extendida no autorizada (deshabilitada y explicada)', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(rolloContinuo());
    renderPage();
    await buscar(user, 'ROLLO58');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'Rollo Continuo' })).toBeChecked();
    expect(campo('Ancho').value).toBe('58');
    expect(campo('Ancho del rollo').value).toBe('');
    expect(screen.queryByLabelText('Cantidad por rollo o paquete')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Doblada' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeDisabled();
    expect(screen.getByTestId('modalidad-EXTENDIDA-blocked')).toHaveTextContent(/no autorizada/);
    expect(screen.getByTestId('family-particularity')).toHaveTextContent(/Extendida no tiene variante gráfica confirmada/);
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta ancho del rollo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Doblada' }));
    fireEvent.change(campo('Ancho del rollo'), { target: { value: '30' } });
    await waitFor(() => expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ modalidad: 'DOBLADA', anchoRollo: '30' }), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![0]).toBe('ROLLO_CONTINUO');
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('cantidad');
  });

  it('Termoencogible: solo texto de color (sin selector de dibujo) y las cuatro cotas técnicas', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(termoencogible());
    renderPage();
    await buscar(user, 'TERMO6');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'Termoencogible' })).toBeChecked();
    for (const label of ['Ancho doblado', 'Medida del pliegue', 'Largo de la presentación final', 'Ancho de la presentación final']) expect(campo(label).value).toBe('');
    expect(screen.queryByRole('combobox', { name: /^Color/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('color-swatch')).not.toBeInTheDocument();
    expect(campo('Texto del color en el documento')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fuelle derecho')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeDisabled();
    expect(screen.getByTestId('status-technical')).toHaveTextContent('incompletos');
  });
});

describe('ManufacturingSpecificationPage · COEX', { timeout: 30_000 }, () => {
  it('sugiere cinco decimales, protege edición manual y pide revisión antes de sustituir pesos', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(coexAzul());
    renderPage();
    await buscar(user, 'COEXAZUL');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Producto').value).toBe('Bolsa con Fuelle - 20% de material reciclado');
    expect(screen.getByText(/no es una característica universal/)).toBeInTheDocument();
    fireEvent.change(campo('Peso de la capa interior (lb)'), { target: { value: '0.20000' } });
    fireEvent.change(campo('Peso (lb)'), { target: { value: '0.7540' } });
    expect(campo('Peso de la capa interior (lb)').value).toBe('0.20000');
    expect(campo('Peso de la capa intermedia (lb)').value).toBe('0.25133');
    expect(campo('Libras de VCI de la capa interior').value).toBe('0.008000');   // 0.20000 × 4 %: sigue al peso de capa vigente
    await user.click(screen.getByRole('button', { name: 'Revisar reemplazo de pesos por sugerencias' }));
    const dialog = screen.getByRole('dialog', { name: 'Revisar reemplazo de pesos por capa' });
    expect(within(dialog).getByText(/0.20000 → 0.25133/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Revisar reemplazo de pesos por capa' })).not.toBeInTheDocument());
    expect(campo('Peso de la capa interior (lb)').value).toBe('0.20000');
    await user.click(screen.getByRole('button', { name: 'Revisar reemplazo de pesos por sugerencias' }));
    await user.click(screen.getByRole('button', { name: 'Reemplazar pesos por sugerencias actuales' }));
    expect(campo('Peso de la capa interior (lb)').value).toBe('0.25133');
    expect(within(frameOf('Peso de la capa interior (lb)')).getByText('Calculado por el sistema')).toBeInTheDocument();
    expect(campo('Libras de VCI de la capa interior').value).toBe('0.010053');      // 0.25133 × 4 %
  });
  it('libras de VCI: calculadas por capa, el valor manual se conserva con aviso y «Restaurar» vuelve al cálculo', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(coexAzul());
    renderPage();
    await buscar(user, 'COEXAZUL');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Libras de VCI de la capa interior').value).toBe('0.005239');
    expect(campo('Libras de VCI de la capa intermedia').value).toBe('0.002619');
    expect(campo('Libras de VCI de la capa exterior').value).toBe('0.000000');
    expect(within(frameOf('Libras de VCI de la capa interior')).getByText('Calculado por el sistema')).toBeInTheDocument();
    // la coherencia del cálculo es del backend: la simulamos con su misma regla (id COEX_VCI:lbVciInterior)
    previewMock.mockImplementation(async (familia, datos) => ({
      html: '<p>coex</p>', familia, borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: null,
      incidencias: datos.lbVciInterior !== '0.010053' && datos.pesoLb === '0.7540'
        ? [{ id: 'COEX_VCI:lbVciInterior', codigo: 'COEX_VCI', nivel: 'CONTRADICCION', campos: ['lbVciInterior'], seccion: 'capas', mensaje: `Las libras de VCI de la capa interior (${datos.lbVciInterior}) no coinciden con el cálculo esperado (0.010053 lb = peso de la capa × 4%). Se conserva el valor capturado; usa «Restaurar» para volver al cálculo.`, origen: 'SISTEMA', afectaVistaPrevia: false, reconocible: true }]
        : []
    }));
    fireEvent.change(campo('Libras de VCI de la capa interior'), { target: { value: '0.006' } });
    fireEvent.change(campo('Peso (lb)'), { target: { value: '0.7540' } });
    expect(campo('Libras de VCI de la capa interior').value).toBe('0.006');
    expect(campo('Libras de VCI de la capa intermedia').value).toBe('0.005027');
    // UNA sola incidencia, en el campo de la capa: ni alerta global ni texto en la vista previa
    const incidencia = await within(frameOf('Libras de VCI de la capa interior')).findByTestId('incidencia', undefined, { timeout: 3000 });
    expect(incidencia).toHaveTextContent(/\(0\.006\) no coinciden con el cálculo esperado \(0\.010053 lb/);
    expect(screen.getAllByText(/no coinciden con el cálculo esperado/)).toHaveLength(1);
    expect(screen.getByTestId('resumen-CONTRADICCION')).toHaveTextContent('1 contradicción');
    await user.click(screen.getByRole('button', { name: 'Restaurar Libras de VCI de la capa interior' }));
    expect(campo('Libras de VCI de la capa interior').value).toBe('0.010053');
    await waitFor(() => expect(screen.queryByText(/no coinciden con el cálculo esperado/)).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByTestId('resumen-CONTRADICCION')).not.toBeInTheDocument();
  });
  it('Producto cambia con familia mientras sea sugerido; la denominación manual permanece', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    expect(campo('Producto').value).toBe('Bolsa PLANA');
    await user.click(screen.getByRole('radio', { name: 'Bolsa Natural' }));
    expect(campo('Producto').value).toBe('Bolsa con Fuelle');
    fireEvent.change(campo('Producto'), { target: { value: 'Mi producto particular' } });
    await user.click(screen.getByRole('radio', { name: 'Termoencogible' }));
    expect(campo('Producto').value).toBe('Mi producto particular');
    expect(campo('Descripción').value).toBe(schfpmg001().producto.Title);
  });
  it('COEX es UNA familia con selector de variante (Azul/Verde) y tres capas con formulación fija', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(coexAzul());
    renderPage();
    await buscar(user, 'COEXAZUL');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getAllByRole('radio', { name: /COEX/ })).toHaveLength(1);              // una sola opción de familia: COEX
    expect(screen.getByRole('radio', { name: 'COEX' })).toBeChecked();
    expect(campo('Variante COEX')).toBeInTheDocument();
    expect(within(frameOf('Variante COEX')).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(campo('Texto del color en el documento').value).toBe('AZUL');
    expect(screen.queryByLabelText('Resina VCI')).not.toBeInTheDocument();                // sin concentración general de 3 %
    expect(screen.getByTestId('capa-interior')).toHaveTextContent('VCI PMG al 4%');
    expect(screen.getByTestId('capa-intermedia')).toHaveTextContent('VCI PMG al 2%');
    expect(screen.getByTestId('capa-exterior')).toHaveTextContent('SIN VCI');
    expect(campo('Libras de VCI de la capa exterior').value).toBe('0.000000');
    expect(campo('Peso de la capa interior (lb)').value).toBe('0.13097');
    expect(within(frameOf('Peso de la capa interior (lb)')).getByText('Calculado por el sistema')).toBeInTheDocument();
    expect(campo('Fuelle derecho').value).toBe('11.8');
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: /^Color/ })).not.toBeInTheDocument();  // sin selector de color libre: solo la variante
    fireEvent.change(campo('Libras de VCI de la capa interior'), { target: { value: '' } });   // el usuario las vacía: el faltante se sigue reportando
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos técnicos/)).toBeInTheDocument();
    expect(screen.getByText(/Falta libras de VCI de la capa interior/i)).toBeInTheDocument();
  });

  it('con pesos por capa y variante la vista previa recibe la variante y los datos capturados; cambiar a Verde actualiza el texto del color', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(coexAzul());
    renderPage();
    await buscar(user, 'COEXAZUL');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    for (const [label, valor] of [['Peso de la capa interior (lb)', '0.13097'], ['Peso de la capa intermedia (lb)', '0.13097'], ['Peso de la capa exterior (lb)', '0.13097'], ['Libras de VCI de la capa interior', '0.005239'], ['Libras de VCI de la capa intermedia', '0.002619']] as const) {
      fireEvent.change(campo(label), { target: { value: valor } });
    }
    expect(screen.getByTestId('status-technical')).toHaveTextContent('Datos técnicos suficientes');
    await waitFor(() => expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ coexVariante: 'AZUL', pesoCapaInterior: '0.13097', lbVciIntermedia: '0.002619', composicion: 'PMG' }), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![0]).toBe('COEX');
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('colorHex');
    await user.click(screen.getByRole('combobox', { name: /^Variante COEX/ }));
    await user.click(await screen.findByRole('option', { name: /COEX Verde/ }));
    expect(campo('Texto del color en el documento').value).toBe('VERDE');
    await waitFor(() => expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ coexVariante: 'VERDE', colorNombre: 'VERDE' }), { timeout: 3000 });
  });

  it('sin color declarado en BIND la variante queda pendiente y la especificación técnica incompleta', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(coexSinColor());
    renderPage();
    await buscar(user, 'COEXAZUL');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect((campo('Variante COEX')).textContent ?? '').not.toMatch(/COEX (Azul|Verde)/);
    expect(within(frameOf('Variante COEX')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    expect(screen.getByTestId('status-technical')).toHaveTextContent('incompletos');
  });
});

describe('ManufacturingSpecificationPage · procedencia Title/Code', { timeout: 30_000 }, () => {
  const chipsDe = (label: string) => within(frameOf(label)).queryAllByTestId('source-chip').map((c) => c.textContent);

  it('composición inferida del Code: se muestra como «Inferido de Code» (y sugerida), nunca como extraída del Title; el material interpretado también', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(resinaInferidaDeCode());
    renderPage();
    await buscar(user, 'IMPFPMG012');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeChecked();
    const composicion = screen.getByRole('radio', { name: 'PMG' }).closest('div.MuiBox-root') as HTMLElement;
    expect(within(composicion).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(within(composicion).getByTestId('source-chip')).toHaveTextContent('Inferido de Code');
    expect(within(composicion).getByText(/Inferida de la clave PMG del código/)).toBeInTheDocument();
    expect(screen.getByTestId('material-row')).toHaveTextContent('Film / plástico · clave PMG');
    expect(within(screen.getByTestId('material-row')).getByTestId('source-chip')).toHaveTextContent('Inferido de Code');
    expect(screen.queryByText(/se infirió de la clave PMG del código/)).not.toBeInTheDocument();         // la procedencia ya la dicen el chip y la nota del campo: no se repite como alerta
    // una corrección manual reemplaza la procedencia y se puede restaurar
    await user.click(screen.getByRole('radio', { name: 'CP5000' }));
    expect(within(composicion).queryByTestId('source-chip')).not.toBeInTheDocument();
    expect(within(composicion).getByText('Editado por el usuario')).toBeInTheDocument();
    expect(campo('Resina VCI').value).toBe('CP5000 AL 3%');            // la resina sugerida (no editada) sigue a la composición del usuario
    await user.click(within(composicion).getByRole('button', { name: 'Restaurar Composición' }));
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeChecked();
    expect(within(composicion).getByTestId('source-chip')).toHaveTextContent('Inferido de Code');
  });

  it('Title y Code coinciden: «Corroborado por Title y Code»; solo Title: «Extraído de Title»', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValueOnce(resinaCorroborada()).mockResolvedValueOnce(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    const composicion = () => screen.getByRole('radio', { name: 'PMG' }).closest('div.MuiBox-root') as HTMLElement;
    expect(within(composicion()).getByTestId('source-chip')).toHaveTextContent('Corroborado por Title y Code');
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    await waitFor(() => expect(within(composicion()).getByTestId('source-chip')).toHaveTextContent('Extraído de Title'));
    expect(chipsDe('Calibre')).toEqual([]);                                 // los demás campos no muestran fuente de Code
  });

  it('contradicción Title/Code: se conserva el Title, se muestra «Contradicción Title/Code» y la advertencia', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(resinaContradictoria());
    renderPage();
    await buscar(user, 'ITESFCP002');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeChecked();
    const composicion = screen.getByRole('radio', { name: 'PMG' }).closest('div.MuiBox-root') as HTMLElement;
    expect(within(composicion).getByTestId('source-chip')).toHaveTextContent('Contradicción Title/Code');
    expect(screen.getByText(/El código sugiere la resina CP5000, pero el título indica PMG: se conserva el título/)).toBeInTheDocument();
  });

  it('producto de papel (TARPPW3301): material Papel · PW33 corroborado, sin familia plástica y con la explicación; no es un error de BIND', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(productoPapel());
    renderPage();
    await buscar(user, 'TARPPW3301');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByTestId('material-row')).toHaveTextContent('Papel · clave PW33');
    expect(screen.getAllByText(/no hay una plantilla de papel disponible en este prototipo/)).toHaveLength(1);          // la explicación aparece UNA vez (sección de familia)
    expect(within(screen.getByTestId('incidencias-familia')).getByText(/no hay una plantilla de papel/)).toBeInTheDocument();
    for (const familia of familyConfigs) expect(screen.getByRole('radio', { name: familia.nombre })).not.toBeChecked();
    expect(screen.queryByText(/Producto de papel: fuera del alcance/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No se encontró un producto/)).not.toBeInTheDocument();
  });
});

// Incidencias unificadas: una causa se identifica una sola vez, se explica donde se corrige y se resume sin repetir el texto íntegro.
describe('ManufacturingSpecificationPage · incidencias unificadas', { timeout: 30_000 }, () => {
  const deId = (id: string) => screen.queryAllByTestId('incidencia').filter((e) => e.getAttribute('data-incidencia-id') === id);
  const completa = { html: '<p>x</p>', familia: 'BOLSA_PLANA_1' as const, borrador: true as const, firmas: 'SIN_FIRMA' as const, completo: true, faltantes: [], advertencias: [], pendientesEmision: [], bloqueado: null };

  it('un dato faltante (unidad dimensional) se explica UNA vez en el campo; el resumen lo cuenta y permite localizarlo; desaparece al corregirlo', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(casoB());
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await user.click(screen.getByRole('radio', { name: 'Bolsa Plana 1' }));
    // antes de validar: el campo no se marca en rojo, pero la revisión ya lo cuenta (y el texto de BIND «no indica la unidad» no se repite como alerta)
    expect(screen.getByTestId('resumen-ERROR')).toBeInTheDocument();
    expect(screen.queryByText(/El título no indica la unidad de las dimensiones/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(deId('FALTANTE:unidadDimensiones')).toHaveLength(1);
    expect(screen.getAllByText('La unidad dimensional no está identificada.')).toHaveLength(1);
    // el resumen coincide con las incidencias reales (errores + contradicciones + pendientes listados) y localiza el campo
    await user.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const items = screen.getAllByTestId('resumen-item');
    const cuentas = ['ERROR', 'CONTRADICCION', 'PENDIENTE'].map((n) => Number(screen.queryByTestId(`resumen-${n}`)?.textContent?.split(' ')[0] ?? 0));
    expect(items).toHaveLength(cuentas.reduce((a, b) => a + b, 0));
    const ids = items.map((e) => e.getAttribute('data-incidencia-id'));
    expect(new Set(ids).size).toBe(ids.length);
    const unidad = items.find((e) => e.getAttribute('data-incidencia-id') === 'FALTANTE:unidadDimensiones')!;
    await user.click(within(unidad).getByRole('button', { name: 'Ir' }));
    expect(frameOf('Unidad de las medidas').contains(document.activeElement)).toBe(true);
    // corregir el dato elimina la incidencia en todos los lugares
    await user.click(screen.getByRole('combobox', { name: /Unidad de las medidas/ }));
    await user.click(await screen.findByRole('option', { name: /Pulgadas/ }));
    await waitFor(() => expect(deId('FALTANTE:unidadDimensiones')).toHaveLength(0));
    expect(screen.queryByText('La unidad dimensional no está identificada.')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('resumen-item').some((e) => e.getAttribute('data-incidencia-id') === 'FALTANTE:unidadDimensiones')).toBe(false);
  });

  it('una contradicción de varias fuentes (formulario, backend y BIND) se muestra y se cuenta UNA vez', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(resinaContradictoria());
    previewMock.mockResolvedValue({ ...completa, incidencias: [
      { id: 'TITLE_CODE:composicion', codigo: 'TITLE_CODE', nivel: 'CONTRADICCION', campos: ['composicion'], seccion: 'composicion', mensaje: 'El título indica PMG y el código indica CP: se conserva el título.', origen: 'CONCILIACION', afectaVistaPrevia: false, reconocible: true }
    ] });
    renderPage();
    await buscar(user, 'ITESFCP002');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await waitFor(() => expect(deId('TITLE_CODE:composicion')).toHaveLength(1), { timeout: 3000 });
    expect(screen.getByTestId('resumen-CONTRADICCION')).toHaveTextContent('1 contradicción');
    expect(screen.queryAllByTestId('incidencia').filter((e) => /código (sugiere la resina|indica CP)/.test(e.textContent ?? ''))).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Producto en BIND' })).queryByTestId('incidencia')).not.toBeInTheDocument();      // el panel de BIND solo muestra procedencia
  });

  it('con solo avisos informativos (cliente vacío) la revisión del borrador se puede confirmar: no bloquean', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    const revisar = screen.getByRole('button', { name: 'Confirmar revisión del borrador' });
    await waitFor(() => expect(screen.getByTestId('resumen-INFORMACION')).toBeInTheDocument());       // solo informativas (cliente)
    await waitFor(() => expect(revisar).toBeEnabled(), { timeout: 3000 });
    expect(screen.queryByTestId('resumen-ERROR')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resumen-CONTRADICCION')).not.toBeInTheDocument();
    await user.click(revisar);
    expect(screen.getByTestId('status-reviewed')).toHaveTextContent('Datos revisados para este borrador');
  });

  it('una respuesta tardía del backend para datos anteriores no hace reaparecer mensajes obsoletos', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    let resolverViejo: (r: unknown) => void = () => undefined;
    previewMock.mockImplementationOnce(() => new Promise((resolve) => { resolverViejo = resolve as never; }));
    renderPage();
    await buscar(user);
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(campo('Ancho'), { target: { value: '14' } });
    await waitFor(() => expect(previewMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await act(async () => {
      resolverViejo({ ...completa, completo: false, incidencias: [{ id: 'COLOR_AZUL:colorPreset', codigo: 'COLOR_AZUL', nivel: 'CONTRADICCION', campos: ['colorPreset'], seccion: 'color', mensaje: 'MENSAJE OBSOLETO', origen: 'TITLE', afectaVistaPrevia: false, reconocible: true }] });
      await Promise.resolve();
    });
    expect(screen.queryByText('MENSAJE OBSOLETO')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resumen-CONTRADICCION')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-blocked-hint')).not.toBeInTheDocument();
  });

  it('Rollo Continuo: la advertencia de BIND sobre la cantidad no aplica (la familia no tiene cantidad) y Extendida no autorizada no se ofrece', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(rolloContinuo());
    renderPage();
    await buscar(user, 'ROLLO58');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await user.click(await screen.findByRole('button', { name: 'Confirmar familia' }));
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeDisabled();
    expect(screen.queryByLabelText('Cantidad por rollo o paquete')).not.toBeInTheDocument();
    expect(screen.queryByText(/no indica la cantidad de bolsas u hojas/)).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { listManufacturingFamilies } from '../services/manufacturingFamilies';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { bolsaFuelle, bolsaNatural, casoB, coexAzul, coexSinColor, deepFreeze, familyConfigs, rolloContinuo, schfpmg001, termoencogible } from '../test/bindProductFixtures';
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
    expect(screen.getByTestId('emission-pending-list')).toHaveTextContent(/Cliente sin identificar: se permite en la demostración/);
    await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(screen.getByTestId('preview-emission-pending')).toHaveTextContent(/Cliente/);

    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Datos técnicos suficientes para la vista previa/)).toBeInTheDocument();
    expect(screen.getByText(/Falta identificar el cliente para una emisión futura/)).toBeInTheDocument();
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
    expect(screen.getByTestId('emission-pending-list')).toHaveTextContent(/texto libre/);
    await user.clear(campo(CLIENTE));
    await elegirCliente(user);
    expect(within(frameOf(CLIENTE)).getByText('Cliente del catálogo (confirmado)')).toBeInTheDocument();
    expect(screen.getByTestId('status-emission')).toHaveTextContent('No apto para emisión futura');            // la familia sigue siendo una sugerencia
    await user.click(screen.getByRole('button', { name: 'Confirmar familia' }));
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
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('fuelleTotal');
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
    expect((await screen.findAllByTestId('live-warning')).map((e) => e.textContent).join(' ')).toMatch(/Fuelle derecho \(26\) no aplica a Bolsa Plana 1/);
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
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta hoja doblada o extendida/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Extendida' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Datos técnicos suficientes para la vista previa/)).toBeInTheDocument();
    expect((await screen.findAllByTestId('live-warning')).map((e) => e.textContent).join(' ')).toMatch(/Familia incompatible con los datos de BIND: BIND describe una bolsa, no una hoja/);
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
    expect(campo('Libras de VCI de la capa exterior').value).toBe('0');
    expect(campo('Peso de la capa interior (lb)').value).toBe('');                       // no se calcula
    expect(campo('Fuelle derecho').value).toBe('11.8');
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: /^Color/ })).not.toBeInTheDocument();  // sin selector de color libre: solo la variante
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos técnicos/)).toBeInTheDocument();
    expect(screen.getByText(/Falta peso de la capa interior/i)).toBeInTheDocument();
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

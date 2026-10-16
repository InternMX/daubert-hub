import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { casoB, deepFreeze, schfpmg001 } from '../test/bindProductFixtures';
import { ManufacturingSpecificationPage } from './ManufacturingSpecificationPage';
import { localIsoDate } from './specificationForm';

vi.mock('../services/bindProducts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/bindProducts')>()), lookupBindProductByCode: vi.fn() }));
vi.mock('../services/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/clients')>()), listClients: vi.fn() }));

vi.mock('../services/sheetPreview', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/sheetPreview')>()), previewManufacturingSheet: vi.fn() }));
const previewMock = vi.mocked(previewManufacturingSheet);
const lookupMock = vi.mocked(lookupBindProductByCode);
const listClientsMock = vi.mocked(listClients);

function renderPage() { return render(<MemoryRouter><ManufacturingSpecificationPage /></MemoryRouter>); }

async function buscar(user: ReturnType<typeof userEvent.setup>, code = 'SCHFPMG001') {
  fireEvent.change(screen.getByLabelText('Código DCMX a buscar'), { target: { value: code } });
  await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
}

const campo = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const frameOf = (label: string) => campo(label).closest('div.MuiBox-root') as HTMLElement;
const clienteCatalogo = { id: 'c-1', commercialName: 'Schneider Electric', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO' as const, notes: null, roles: ['CLIENTE'], fiscal: null };

async function elegirCliente(user: ReturnType<typeof userEvent.setup>) {
  listClientsMock.mockResolvedValue({ data: [clienteCatalogo], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } });
  await user.type(campo('Cliente (obligatorio)'), 'Schn');
  await user.click(await screen.findByRole('option', { name: 'Schneider Electric' }));
}

beforeEach(() => {
  previewMock.mockImplementation(async (familia, datos) => ({
    html: `<p>${familia} ancho=${datos.ancho} largo=${datos.largo} cantidad=${datos.cantidad} calibre=${datos.calibre} etiqueta=${datos.etiqueta} color=${datos.colorNombre}|${datos.colorHex} cliente=${datos.cliente}</p>`,
    familia, borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: []
  }));
  listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
});
afterEach(() => { vi.clearAllMocks(); });

// El formulario completo (MUI + vista previa con debounce) es costoso de renderizar: con la suite completa en paralelo y cobertura, 5 s no alcanzan.
describe('ManufacturingSpecificationPage', { timeout: 30_000 }, () => {
  it('muestra el buscador y no consulta nada hasta que el usuario lo pide', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Especificación de manufactura' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeDisabled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('flujo SCHFPMG001: precarga BIND, sugiere familia, PMG AL 3%, Daubert Azul, fecha y etiqueta, cada una con su procedencia', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(deepFreeze(schfpmg001()));
    renderPage();
    await buscar(user);
    expect(lookupMock).toHaveBeenCalledWith('SCHFPMG001', expect.any(AbortSignal));

    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(within(panel).getByText('Solo lectura')).toBeInTheDocument();
    expect(within(panel).getByText(/no la fecha de emisión/i)).toBeInTheDocument();

    expect(campo('Código DCMX').value).toBe('SCHFPMG001');
    expect(campo('Ancho').value).toBe('13');
    expect(campo('Calibre').value).toBe('3 MIL');
    expect(campo('Cantidad por rollo o paquete').value).toBe('200');
    expect(campo('Resina VCI').value).toBe('PMG AL 3%');
    expect(within(frameOf('Resina VCI')).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(campo('Fecha de emisión de la hoja').value).toBe(localIsoDate());
    expect(within(frameOf('Fecha de emisión de la hoja')).getByText('Sugerido por el sistema')).toBeInTheDocument();
    expect(campo('Etiqueta').value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(campo('Texto del color en el documento').value).toBe('DAUBERT AZUL AL 2%');
    expect(campo('Concentración del color (%)').value).toBe('2');
    expect(screen.getByTestId('color-hex-readonly')).toHaveTextContent('#538DD5');
    expect(within(frameOf('Ancho')).getByText('Recuperado de BIND')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Paquete' })).toBeChecked();
  });

  it('la familia sugerida se muestra seleccionada, provisional y editable; «Hojas» sustituye a «Hoja Paq»', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Familia de manufactura' });
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Hojas' })).not.toBeChecked();
    expect(screen.queryByText(/Hoja Paq/)).not.toBeInTheDocument();
    expect(screen.getByTestId('family-chip')).toHaveTextContent('Sugerida por el sistema (provisional)');
    expect(screen.getByTestId('family-note')).toHaveTextContent(/dos medidas/);
    await user.click(screen.getByRole('button', { name: 'Confirmar familia' }));
    expect(screen.getByTestId('family-chip')).toHaveTextContent('Familia elegida por el usuario');
  });

  it('sin información suficiente la familia queda pendiente y se explica el motivo', async () => {
    const user = userEvent.setup();
    const base = schfpmg001();
    lookupMock.mockResolvedValue({ ...base, familiaSugerida: [], sugerencias: { ...base.sugerencias, familia: { valor: null, motivo: 'Hay indicios de fuelle u otra familia especial: no se sugiere Bolsa Plana 1.', incompatibles: [] } } });
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Familia de manufactura' });
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Hojas' })).not.toBeChecked();
    expect(screen.getByTestId('family-note')).toHaveTextContent(/fuelle/);
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
    expect(screen.getByText(/Campos modificados por el usuario: Ancho/)).toBeInTheDocument();
    expect(panel.textContent).toBe(antes);
    expect(original.interpretacion.campos.ancho.valor).toBe(13);

    await user.click(screen.getByRole('button', { name: 'Restaurar Ancho' }));
    expect(campo('Ancho').value).toBe('13');
    expect(within(frameOf('Ancho')).getByText('Recuperado de BIND')).toBeInTheDocument();
  });

  it('muestra campos particulares según la familia: modalidad solo en Hojas', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    expect(await screen.findByRole('region', { name: 'Datos de Bolsa Plana 1' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Extendida' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    expect(screen.getByRole('region', { name: 'Datos de Hojas' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Doblada' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeInTheDocument();
  });

  it('cliente ausente: se puede editar y ver el borrador, pero la especificación no se muestra completa y hay un pendiente claro', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(screen.getByTestId('status-preview')).toHaveTextContent('Borrador previsualizable');
    expect(screen.getByTestId('status-complete')).toHaveTextContent('incompletos');
    expect(screen.getByTestId('pending-list')).toHaveTextContent(/Cliente: selecciona un cliente del catálogo/);
    await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });     // el borrador sigue visible

    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/Selecciona un cliente del catálogo: el texto libre/)).toBeInTheDocument();
    expect(screen.queryByText(/La especificación está completa/)).not.toBeInTheDocument();
  });

  it('el texto libre no vincula al cliente; elegirlo del catálogo resuelve el pendiente y, con la familia confirmada, queda confirmada', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Cliente (obligatorio)').value).toBe('');                       // el prefijo SCH del código no autocompleta nada
    expect(screen.getByText(/No se infiere por el prefijo del código/)).toBeInTheDocument();

    await user.type(campo('Cliente (obligatorio)'), 'Nuevo Cliente SA');
    expect(within(frameOf('Cliente (obligatorio)')).getByText('Texto libre: no vinculado al catálogo')).toBeInTheDocument();
    expect(screen.getByTestId('status-complete')).toHaveTextContent('incompletos');

    await user.clear(campo('Cliente (obligatorio)'));
    await elegirCliente(user);
    expect(within(frameOf('Cliente (obligatorio)')).getByText('Cliente del catálogo (confirmado)')).toBeInTheDocument();
    expect(screen.getByTestId('status-complete')).toHaveTextContent('Datos obligatorios completos');
    expect(screen.getByTestId('status-confirmed')).toHaveTextContent('No confirmada');            // la familia sigue siendo una sugerencia
    expect(screen.getByTestId('pending-list')).toHaveTextContent(/Familia: Bolsa Plana 1 es una sugerencia/);

    await user.click(screen.getByRole('button', { name: 'Confirmar familia' }));
    expect(screen.getByTestId('status-confirmed')).toHaveTextContent('Confirmada por el usuario');
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/La especificación está completa y la familia fue confirmada/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no se guarda ni se emite ninguna hoja/)).toBeInTheDocument();
  });

  it('Hojas exige la modalidad y advierte la familia incompatible con una bolsa', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    await elegirCliente(user);
    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta hoja doblada o extendida/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Extendida' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/La especificación está completa y la familia fue confirmada/)).toBeInTheDocument();
    expect(screen.getByText(/Familia incompatible con los datos de BIND: BIND describe una bolsa, no una hoja/)).toBeInTheDocument();
  });

  it('caso B: conserva CAL.200 literal, sin exigir unidad; los pendientes reales siguen marcados', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(casoB());
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Calibre').value).toBe('200');
    expect(within(frameOf('Calibre')).getByText('Recuperado de BIND')).toBeInTheDocument();
    expect(screen.queryByLabelText('Calibre (unidad)')).not.toBeInTheDocument();
    expect(within(frameOf('Peso (lb)')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    await elegirCliente(user);
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/Falta peso \(lb\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/Falta calibre/i)).not.toBeInTheDocument();
  });

  it('color unificado: un solo selector actualiza el texto del documento y el dibujo; Otro valida nombre y #RRGGBB con muestra visual', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Color' });
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(83, 141, 213)' });

    await user.click(screen.getByRole('combobox', { name: /^Color/ }));
    await user.click(await screen.findByRole('option', { name: /^Verde/ }));
    expect(campo('Texto del color en el documento').value).toBe('VERDE');
    expect(screen.getByTestId('color-hex-readonly')).toHaveTextContent('#00B050');
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(0, 176, 80)' });
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('color=VERDE|#00B050'), { timeout: 3000 });

    await user.click(screen.getByRole('combobox', { name: /^Color/ }));
    await user.click(await screen.findByRole('option', { name: /^Otro/ }));
    expect(screen.queryByTestId('color-hex-readonly')).not.toBeInTheDocument();
    await elegirCliente(user);
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#GG0000' } });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Escribe el nombre del color/)).toBeInTheDocument();
    expect(screen.getByText(/El color debe tener el formato #RRGGBB/)).toBeInTheDocument();
    expect(screen.getByText(/Faltan datos obligatorios/)).toBeInTheDocument();
    fireEvent.change(campo('Texto del color en el documento'), { target: { value: 'ROJO' } });
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#C00000' } });
    expect(screen.getByTestId('color-swatch')).toHaveStyle({ backgroundColor: 'rgb(192, 0, 0)' });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.queryByText(/El color debe tener el formato/)).not.toBeInTheDocument();
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
    expect(restaurar).toBeEnabled();
    await user.click(restaurar);
    expect(campo('Etiqueta').value).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(campo('Descripción').value).toBe('Descripción corregida');
  });

  it('estados: cargando, no encontrado, error de BIND y código no válido', async () => {
    const user = userEvent.setup();
    let resolver: (v: ReturnType<typeof schfpmg001>) => void = () => undefined;
    lookupMock.mockReturnValueOnce(new Promise((resolve) => { resolver = resolve; }));
    renderPage();
    await buscar(user);
    expect(await screen.findByText('Consultando BIND…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeDisabled();
    resolver(schfpmg001());
    await screen.findByRole('region', { name: 'Producto en BIND' });

    lookupMock.mockRejectedValueOnce(new BindProductApiError('NOT_FOUND', 404));
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText('No se encontró un producto con ese código en BIND.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Producto en BIND' })).not.toBeInTheDocument();

    lookupMock.mockRejectedValueOnce(new BindProductApiError('BIND_UNAVAILABLE', 502));
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText('No se pudo consultar BIND en este momento.')).toBeInTheDocument();

    lookupMock.mockRejectedValueOnce(new BindProductApiError('MULTIPLE_MATCHES', 409));
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText(/varios productos/)).toBeInTheDocument();

    fireEvent.change(campo('Código DCMX a buscar'), { target: { value: "X' or 1" } });
    await user.click(screen.getByRole('button', { name: 'Buscar en BIND' }));
    expect(await screen.findByText(/El código no es válido/)).toBeInTheDocument();
    expect(lookupMock).toHaveBeenCalledTimes(4);
  });

  it('una nueva búsqueda inicia un borrador nuevo: reemplaza el formulario anterior y descarta las ediciones', async () => {
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

  it('vista previa: usa la plantilla de la familia sugerida y refleja correcciones, calibre literal y etiqueta sin alterar el producto de BIND', async () => {
    const user = userEvent.setup();
    const original = deepFreeze(casoB());
    lookupMock.mockResolvedValue(original);
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    const antes = panel.textContent;

    const frame = await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(frame.getAttribute('srcdoc')).toContain('calibre=200 ');
    expect(frame.getAttribute('srcdoc')).toContain('etiqueta=Bolsa PMG 58 X 43 Cal.200 Paquete 100 bolsas');
    expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ codigo: 'PRUEBA58X43', composicion: 'PMG', calibre: '200', colorNombre: 'DAUBERT AZUL AL 2%', colorHex: '#538DD5', resinaVci: 'PMG AL 3%' });
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('modalidad');
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('ID');

    fireEvent.change(campo('Ancho'), { target: { value: '60' } });
    fireEvent.change(campo('Calibre'), { target: { value: '2 MIL' } });
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('ancho=60 largo=43 cantidad=100 calibre=2 MIL'), { timeout: 3000 });
    expect(panel.textContent).toBe(antes);
    expect(original.interpretacion.campos.ancho.valor).toBe(58);
    expect(original.interpretacion.campos.calibre.valor?.valorOriginal).toBe('200');

    await user.click(screen.getByRole('radio', { name: 'Hojas' }));
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Hojas').getAttribute('srcdoc')).toContain('HOJA_PAQ'), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![1]).toHaveProperty('modalidad');
    expect(screen.getAllByText('BORRADOR · SIN APROBAR').length).toBeGreaterThan(0);
  });
});

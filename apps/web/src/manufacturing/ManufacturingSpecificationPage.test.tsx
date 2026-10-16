import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BindProductApiError, lookupBindProductByCode } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { previewManufacturingSheet } from '../services/sheetPreview';
import { casoB, deepFreeze, schfpmg001 } from '../test/bindProductFixtures';
import { ManufacturingSpecificationPage } from './ManufacturingSpecificationPage';

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

beforeEach(() => {
  previewMock.mockImplementation(async (familia, datos) => ({ html: `<p>${familia} ancho=${datos.ancho} largo=${datos.largo} cantidad=${datos.cantidad} calibre=${datos.calibreValor}</p>`, familia, borrador: true, firmas: 'SIN_FIRMA', completo: true, faltantes: [], advertencias: [] }));
  listClientsMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } });
});
afterEach(() => { vi.clearAllMocks(); });

describe('ManufacturingSpecificationPage', () => {
  it('muestra el buscador y no consulta nada hasta que el usuario lo pide', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Especificación de manufactura' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buscar en BIND' })).toBeDisabled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('flujo SCHFPMG001: busca, muestra el producto de BIND y precarga el formulario con su procedencia', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(deepFreeze(schfpmg001()));
    renderPage();
    await buscar(user);
    expect(lookupMock).toHaveBeenCalledWith('SCHFPMG001', expect.any(AbortSignal));

    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(within(panel).getByText('bbe2cc0c-3498-47cb-a556-d435eba5c0b4')).toBeInTheDocument();
    expect(within(panel).getByText('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS')).toBeInTheDocument();
    expect(within(panel).getByText('0.0428')).toBeInTheDocument();
    expect(within(panel).getByText('Solo lectura')).toBeInTheDocument();
    expect(within(panel).getByText(/no la fecha de emisión/i)).toBeInTheDocument();

    expect(campo('Código DCMX').value).toBe('SCHFPMG001');
    expect(campo('Código DCMX a buscar').value).toBe('SCHFPMG001');   // el buscador conserva su valor; el formulario tiene su propio campo
    expect(campo('Ancho').value).toBe('13');
    expect(campo('Largo').value).toBe('16');
    expect(campo('Calibre (valor)').value).toBe('3');
    expect(campo('Calibre (unidad)').value).toBe('MIL');
    expect(campo('Cantidad por rollo o paquete').value).toBe('200');
    expect(campo('Peso (lb)').value).toBe('0.0428');
    expect(screen.getByRole('radio', { name: 'PMG' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Paquete' })).toBeChecked();
    expect(within(frameOf('Ancho')).getByText('Recuperado de BIND')).toBeInTheDocument();
    expect(within(frameOf('Cliente')).getByText('Captura manual')).toBeInTheDocument();
    expect(screen.getByText(/no se determina automáticamente/i)).toBeInTheDocument();
  });

  it('la familia no se elige sola: ninguna opción está marcada y la pista de BIND no es vinculante', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Familia de manufactura' });
    expect(screen.getByRole('radio', { name: 'Bolsa Plana 1' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Hoja Paq' })).not.toBeChecked();
    expect(screen.getByText(/Pista del sistema, no vinculante: Bolsa Plana 1/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Datos de/ })).not.toBeInTheDocument();
  });

  it('corregir un valor lo marca como editado SIN alterar el producto original de BIND, y puede restaurarse', async () => {
    const user = userEvent.setup();
    const original = deepFreeze(schfpmg001());       // un intento de mutarlo lanzaría un error
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
    expect(panel.textContent).toBe(antes);                                          // el panel de BIND no cambió
    expect(original.producto.Title).toBe('BOLSA VCI PMG 13 x 16" CAL. 3 MIL PAQUETE C/200 BOLSAS');
    expect(original.interpretacion.campos.ancho.valor).toBe(13);

    await user.click(screen.getByRole('button', { name: 'Restaurar Ancho' }));
    expect(campo('Ancho').value).toBe('13');
    expect(within(frameOf('Ancho')).getByText('Recuperado de BIND')).toBeInTheDocument();
  });

  it('muestra campos particulares según la familia: modalidad solo en Hoja Paq', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await user.click(await screen.findByRole('radio', { name: 'Bolsa Plana 1' }));
    expect(screen.getByRole('region', { name: 'Datos de Bolsa Plana 1' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Extendida' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Hoja Paq' }));
    expect(screen.getByRole('region', { name: 'Datos de Hoja Paq' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Doblada' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Extendida' })).toBeInTheDocument();
  });

  it('no considera completa la especificación con datos obligatorios faltantes y la acepta al completarlos', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });

    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/Falta elegir la familia/)).toBeInTheDocument();
    expect(screen.queryByText(/todos los datos obligatorios/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Bolsa Plana 1' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta color del dibujo/i)).toBeInTheDocument();

    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#538DD5' } });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/todos los datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no se guarda ni se emite ninguna hoja/)).toBeInTheDocument();
  });

  it('Hoja Paq exige la modalidad antes de completarse', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    renderPage();
    await buscar(user);
    await user.click(await screen.findByRole('radio', { name: 'Hoja Paq' }));
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#538DD5' } });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Falta hoja doblada o extendida/i)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Extendida' }));
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/todos los datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/BIND describe una Bolsa, pero elegiste Hoja Paq/)).toBeInTheDocument();
  });

  it('caso con pendientes: los marca y exige confirmarlos', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(casoB());
    renderPage();
    await buscar(user, 'PRUEBA58X43');
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(within(frameOf('Calibre (valor)')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    expect(campo('Calibre (valor)').value).toBe('200');
    expect(campo('Calibre (unidad)').value).toBe('');
    expect(within(frameOf('Peso (lb)')).getByText('Pendiente de confirmar')).toBeInTheDocument();
    expect(screen.getByText(/CAL\.200/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Bolsa Plana 1' }));
    fireEvent.change(campo('Color del dibujo (#RRGGBB)'), { target: { value: '#538DD5' } });
    await user.click(screen.getByRole('button', { name: 'Validar especificación' }));
    expect(screen.getByText(/Faltan datos obligatorios/)).toBeInTheDocument();
    expect(screen.getByText(/Falta calibre \(unidad\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Falta peso \(lb\)/i)).toBeInTheDocument();
  });

  it('el cliente puede capturarse provisionalmente o elegirse del catálogo; no se infiere del código', async () => {
    const user = userEvent.setup();
    lookupMock.mockResolvedValue(schfpmg001());
    listClientsMock.mockResolvedValue({ data: [{ id: '1', commercialName: 'Schneider Electric', companyType: 'CLIENTE', status: 'ACTIVO', clientStatus: 'ACTIVO', notes: null, roles: ['CLIENTE'], fiscal: null }], meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 } });
    renderPage();
    await buscar(user);
    await screen.findByRole('region', { name: 'Producto en BIND' });
    expect(campo('Cliente').value).toBe('');                       // el prefijo SCH del código no autocompleta nada
    expect(screen.getByText(/No se infiere por el prefijo del código/)).toBeInTheDocument();
    await user.type(campo('Cliente'), 'Nuevo Cliente SA');
    expect(within(frameOf('Cliente')).getByText('Cliente provisional (sin catálogo)')).toBeInTheDocument();
    await user.clear(campo('Cliente'));
    await user.type(campo('Cliente'), 'Schn');
    await user.click(await screen.findByRole('option', { name: 'Schneider Electric' }));
    expect(within(frameOf('Cliente')).getByText('Catálogo de clientes')).toBeInTheDocument();
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
    expect(lookupMock).toHaveBeenCalledTimes(4);                    // el código inválido no llega al servidor
  });

  it('una nueva búsqueda reemplaza el formulario anterior y descarta las ediciones', async () => {
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
  it('vista previa: sin familia no se consulta; con familia se usa su plantilla y refleja las correcciones sin alterar el producto de BIND', async () => {
    const user = userEvent.setup();
    const original = deepFreeze(schfpmg001());
    lookupMock.mockResolvedValue(original);
    renderPage();
    await buscar(user);
    const panel = await screen.findByRole('region', { name: 'Producto en BIND' });
    const antes = panel.textContent;
    expect(previewMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Selecciona la familia \(Bolsa Plana 1 u Hoja Paq\) para ver la vista previa/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Bolsa Plana 1' }));
    const frame = await screen.findByTitle('Vista previa de la hoja Bolsa Plana 1', undefined, { timeout: 3000 });
    expect(frame.getAttribute('srcdoc')).toContain('BOLSA_PLANA_1 ancho=13 largo=16 cantidad=200 calibre=3');
    expect(previewMock.mock.calls.at(-1)![1]).toMatchObject({ codigo: 'SCHFPMG001', composicion: 'PMG', presentacion: 'PAQUETE', pesoLb: '0.0428', producto: 'Bolsa' });
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('modalidad');
    expect(previewMock.mock.calls.at(-1)![1]).not.toHaveProperty('ID');

    // Un solo cambio por campo (fireEvent): escribir tecla por tecla vuelve a renderizar todo el formulario en cada pulsación y encarece la prueba sin probar nada más.
    fireEvent.change(campo('Ancho'), { target: { value: '14' } });
    fireEvent.change(campo('Cantidad por rollo o paquete'), { target: { value: '300' } });
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Bolsa Plana 1').getAttribute('srcdoc')).toContain('ancho=14 largo=16 cantidad=300'), { timeout: 3000 });
    expect(panel.textContent).toBe(antes);
    expect(original.interpretacion.campos.ancho.valor).toBe(13);

    await user.click(screen.getByRole('radio', { name: 'Hoja Paq' }));
    await waitFor(() => expect(screen.getByTitle('Vista previa de la hoja Hoja Paq').getAttribute('srcdoc')).toContain('HOJA_PAQ'), { timeout: 3000 });
    expect(previewMock.mock.calls.at(-1)![1]).toHaveProperty('modalidad');
    expect(screen.getAllByText('BORRADOR · SIN APROBAR').length).toBeGreaterThan(0);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContact } from '../services/contacts';
import { getContactDirectoryCompany, listContactDirectoryCompanies } from '../services/contactDirectory';
import { ContactsPage } from './ContactsPage';

vi.mock('../services/contactDirectory', () => ({ listContactDirectoryCompanies: vi.fn(), getContactDirectoryCompany: vi.fn() }));
vi.mock('../services/contacts', () => ({ createContact: vi.fn() }));
const listMock = vi.mocked(listContactDirectoryCompanies); const detailMock = vi.mocked(getContactDirectoryCompany); const createMock = vi.mocked(createContact);
const company = { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const, contactCount: 0 };
const detail = { company: { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const }, contacts: [] };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function renderPage(path = '/contacts?company=1&search=almex&page=2&pageSize=25') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/contacts" element={<><ContactsPage /><Location /></>} /></Routes></MemoryRouter>); }
async function selectedPage() { listMock.mockResolvedValue({ data: [company], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue(detail); renderPage(); await screen.findByRole('button', { name: 'Agregar contacto' }); }
async function openDrawer() { fireEvent.click(screen.getByRole('button', { name: 'Agregar contacto' })); return screen.findByRole('dialog'); }
async function selectContactType(drawer: HTMLElement, label: string) { fireEvent.mouseDown(within(drawer).getByLabelText('Tipo de contacto')); fireEvent.click(await screen.findByRole('option', { name: label })); }
async function selectMethodType(drawer: HTMLElement, index: number, label: string) { fireEvent.mouseDown(within(drawer).getAllByLabelText('Tipo')[index]!); fireEvent.click(await screen.findByRole('option', { name: label })); }

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('ContactsPage', () => {
  it('renders existing mixed methods without payment fields and hides Add Contact without selection', async () => {
    listMock.mockResolvedValue({ data: [{ ...company, contactCount: 2 }], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue({ company: detail.company, contacts: [{ id: '3', name: null, contactType: 'BUZON_GENERICO', area: 'Facturación', position: null, isPrimary: false, methods: [{ id: '4', type: 'CORREO', value: 'billing@example.test', isPrimary: true }, { id: '5', type: 'TELEFONO', value: '5550000000', isPrimary: false }, { id: '6', type: 'WHATSAPP', value: '5550000001', isPrimary: false }] }] });
    renderPage('/contacts?company=1'); expect(await screen.findByText('Buzón general')).toBeInTheDocument(); expect(screen.getByText('Correo:')).toBeInTheDocument(); expect(screen.getByText('Teléfono:')).toBeInTheDocument(); expect(screen.getByText('WhatsApp:')).toBeInTheDocument(); expect(screen.queryByText(/PARA|CCO|receives payment/i)).not.toBeInTheDocument();
  });

  it('hides Add Contact without a selected company', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts'); await screen.findByText('Selecciona una empresa.'); expect(screen.queryByRole('button', { name: 'Agregar contacto' })).not.toBeInTheDocument();
  });

  it('opens with company context, dynamic PERSONA/AREA/BUZON fields, and clears hidden values', async () => {
    await selectedPage(); const drawer = await openDrawer(); const form = within(drawer);
    expect(form.getByText('Empresa')).toBeInTheDocument(); expect(form.getByText('ALMEX')).toBeInTheDocument(); expect(form.getByRole('textbox', { name: 'Nombre' })).toBeInTheDocument(); expect(form.getAllByRole('textbox', { name: 'Valor' })).toHaveLength(1); expect(form.getByLabelText('Eliminar medio 1')).toBeDisabled();
    fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: 'Compradora' } }); await selectContactType(drawer, 'Área o departamento'); expect(form.getByRole('textbox', { name: 'Área o departamento' })).toBeInTheDocument(); expect(form.queryByRole('textbox', { name: 'Nombre' })).not.toBeInTheDocument();
    await selectContactType(drawer, 'Persona'); expect(form.getByRole('textbox', { name: 'Nombre' })).toHaveValue(''); expect(form.getByRole('textbox', { name: 'Cargo' })).toHaveValue(''); await selectContactType(drawer, 'Buzón genérico'); expect(form.getByRole('textbox', { name: 'Área' })).toBeInTheDocument(); expect(form.queryByRole('textbox', { name: 'Cargo' })).not.toBeInTheDocument();
  });

  it('supports multiple CORREO, TELEFONO, WHATSAPP, mixed rows, and client validation', async () => {
    await selectedPage(); const drawer = await openDrawer(); const form = within(drawer);
    for (let index = 0; index < 4; index += 1) fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); expect(form.getAllByRole('textbox', { name: 'Valor' })).toHaveLength(5); fireEvent.click(form.getByLabelText('Eliminar medio 5')); expect(form.getAllByRole('textbox', { name: 'Valor' })).toHaveLength(4);
    await selectMethodType(drawer, 1, 'Correo'); await selectMethodType(drawer, 2, 'Teléfono'); await selectMethodType(drawer, 3, 'WhatsApp'); const values = form.getAllByRole('textbox', { name: 'Valor' });
    fireEvent.change(values[0]!, { target: { value: 'bad-email' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); expect(await form.findByText('Ingresa un correo válido.')).toBeInTheDocument();
    fireEvent.change(values[0]!, { target: { value: 'MARIA@example.test' } }); fireEvent.change(values[1]!, { target: { value: 'maria@example.test' } }); fireEvent.change(values[2]!, { target: { value: '+52 (449) 555-0101 ext. 4' } }); fireEvent.change(values[3]!, { target: { value: '+52 449 555 0102' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); expect(await form.findByText('Este medio ya fue agregado.')).toBeInTheDocument(); expect(createMock).not.toHaveBeenCalled();
  });

  it('posts the exact payload, prevents duplicate posts, refreshes directory data, and preserves URL state', async () => {
    let resolveCreate: (() => void) | undefined; createMock.mockImplementation(() => new Promise((resolve) => { resolveCreate = () => resolve({ contact: { id: '9' } as never, requestId: 'request-1' }); }));
    await selectedPage(); const drawer = await openDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: ' María López ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Área' }), { target: { value: ' Compras ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: ' Compradora ' } }); fireEvent.change(form.getAllByRole('textbox', { name: 'Valor' })[0]!, { target: { value: ' maria@example.test ' } });
    fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); await selectMethodType(drawer, 1, 'Teléfono'); await selectMethodType(drawer, 2, 'WhatsApp'); const values = form.getAllByRole('textbox', { name: 'Valor' }); fireEvent.change(values[1]!, { target: { value: '+52 (449) 555-0101 ext. 4' } }); fireEvent.change(values[2]!, { target: { value: '+52 449 555 0102' } });
    fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); fireEvent.click(form.getByRole('button', { name: 'Guardando...' })); expect(createMock).toHaveBeenCalledTimes(1); expect(createMock).toHaveBeenCalledWith({ companyId: '1', contactType: 'PERSONA', name: 'María López', area: 'Compras', position: 'Compradora', notes: null, methods: [{ type: 'CORREO', value: 'maria@example.test' }, { type: 'TELEFONO', value: '+52 (449) 555-0101 ext. 4' }, { type: 'WHATSAPP', value: '+52 449 555 0102' }] }); expect(JSON.stringify(createMock.mock.calls[0]?.[0])).not.toMatch(/recibe_notificacion_pago|tipo_destinatario_pago/); expect(form.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
    await act(async () => resolveCreate?.()); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(await screen.findByText('Contacto registrado correctamente.')).toBeInTheDocument(); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25'); expect(detailMock.mock.calls.length).toBeGreaterThan(1); expect(listMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps values on error, and Cancelar sends no request or future pending/lifecycle controls', async () => {
    createMock.mockRejectedValue(new Error('safe failure')); await selectedPage(); const drawer = await openDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getAllByRole('textbox', { name: 'Valor' })[0]!, { target: { value: 'maria@example.test' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); expect(await form.findByText('No fue posible registrar el contacto. Inténtalo nuevamente.')).toBeInTheDocument(); expect(form.getByRole('textbox', { name: 'Nombre' })).toHaveValue('María'); fireEvent.click(form.getByRole('button', { name: 'Cancelar' })); expect(createMock).toHaveBeenCalledTimes(1); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(screen.queryByText(/Pendientes|Confirmar|Eliminar pendiente/)).not.toBeInTheDocument(); expect(screen.queryByLabelText(/menú|acciones/i)).not.toBeInTheDocument();
  });
});

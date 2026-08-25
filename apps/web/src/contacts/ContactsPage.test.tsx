import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContact, deactivateContact, reactivateContact, updateContact } from '../services/contacts';
import { addContactMethod, deactivateContactMethod, editContactMethod, reactivateContactMethod } from '../services/contactMethods';
import { searchCompanies } from '../services/companies';
import { getContactDirectoryCompany, listContactDirectoryCompanies, type DirectoryContact, type DirectoryContactMethod } from '../services/contactDirectory';
import { ContactsPage } from './ContactsPage';

vi.mock('../services/contactDirectory', () => ({ listContactDirectoryCompanies: vi.fn(), getContactDirectoryCompany: vi.fn() }));
vi.mock('../services/contacts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contacts')>()), createContact: vi.fn(), updateContact: vi.fn(), deactivateContact: vi.fn(), reactivateContact: vi.fn() }));
vi.mock('../services/contactMethods', () => ({ addContactMethod: vi.fn(), deactivateContactMethod: vi.fn(), editContactMethod: vi.fn(), reactivateContactMethod: vi.fn() }));
vi.mock('../services/companies', () => ({ searchCompanies: vi.fn() }));
const listMock = vi.mocked(listContactDirectoryCompanies); const detailMock = vi.mocked(getContactDirectoryCompany); const createMock = vi.mocked(createContact); const updateMock = vi.mocked(updateContact); const addMethodMock = vi.mocked(addContactMethod); const editMethodMock = vi.mocked(editContactMethod); const deactivateMock = vi.mocked(deactivateContactMethod); const reactivateMock = vi.mocked(reactivateContactMethod); const companySearchMock = vi.mocked(searchCompanies); const deactivateContactMock = vi.mocked(deactivateContact); const reactivateContactMock = vi.mocked(reactivateContact);
const company = { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const, contactCount: 0 };
const detail = { company: { id: '1', commercialName: 'ALMEX', companyType: 'FLETE' as const }, contacts: [] as DirectoryContact[], inactiveContacts: [] as DirectoryContact[] };
const lookup = { id: '31', commercialName: 'SILYM', companyType: 'SERVICIO' as const, legalName: 'RUBEN MARQUEZ CORTES', rfc: 'SIM010101AAA', matchedAlias: 'SOLUCIONES INTEGRALES' };
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function renderPage(path = '/contacts?company=1&search=almex&page=2&pageSize=25') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/contacts" element={<><ContactsPage /><Location /></>} /></Routes></MemoryRouter>); }
async function selectedPage() { listMock.mockResolvedValue({ data: [company], meta: { page: 2, pageSize: 25, total: 1, totalPages: 1 } }); detailMock.mockResolvedValue(detail); renderPage(); await screen.findAllByText('ALMEX'); }
async function contextualDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[1]!); return screen.findByRole('dialog'); }
async function globalDrawer() { fireEvent.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]!); const drawer = await screen.findByRole('dialog'); await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'Empresa' })).toHaveValue('')); return drawer; }
async function selectMethodType(drawer: HTMLElement, index: number, label: string) { fireEvent.mouseDown(within(drawer).getAllByLabelText('Tipo')[index]!); fireEvent.click(await screen.findByRole('option', { name: label })); }
const activeMethod = { id: '9007199254740993', type: 'CORREO' as const, value: 'activo@example.test', isPrimary: true };
const inactiveMethod = { id: '9007199254740994', type: 'OTRO' as const, value: 'anterior@example.test', isPrimary: false };
const inactivePhoneMethod = { id: '9007199254740995', type: 'TELEFONO' as const, value: '+52 449 555 0101', isPrimary: false };
function contactDetail(methods: DirectoryContactMethod[] = [activeMethod], inactiveMethods: DirectoryContactMethod[] = [inactiveMethod], inactiveContacts: DirectoryContact[] = []): Awaited<ReturnType<typeof getContactDirectoryCompany>> { return { company: detail.company, contacts: [{ id: '20', name: 'Contacto Sintético', contactType: 'PERSONA' as const, area: 'Compras', position: null, notes: 'Nota inicial', isPrimary: false, methods, inactiveMethods }], inactiveContacts }; }
function inactiveContactFixture(methods: DirectoryContactMethod[] = [activeMethod], inactiveMethods: DirectoryContactMethod[] = [inactivePhoneMethod]): DirectoryContact { return { id: '20', name: 'Contacto Sintético', contactType: 'PERSONA' as const, area: 'Compras', position: null, notes: 'Nota inicial', isPrimary: false, methods, inactiveMethods }; }
const listMeta = { page: 2, pageSize: 25, total: 1, totalPages: 1 };
async function lifecyclePage(initial = contactDetail()) { listMock.mockResolvedValue({ data: [{ ...company, contactCount: initial.contacts.length }], meta: listMeta }); detailMock.mockResolvedValue(initial); renderPage(); await screen.findAllByText('Contacto Sintético'); }
async function openContactMenu() { fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' })); return screen.findByRole('menuitem', { name: 'Desactivar contacto' }); }
async function deactivateViaMenu() { fireEvent.click(await openContactMenu()); return within(await screen.findByRole('dialog', { name: 'Desactivar contacto' })).getByRole('button', { name: 'Desactivar' }); }

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('ContactsPage global creation', () => {
  it('renders the global action and opens a company autocomplete with no selected company', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts');
    expect(await screen.findByRole('button', { name: 'Agregar contacto' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const drawer = await globalDrawer(); expect(within(drawer).getByRole('combobox', { name: 'Empresa' })).toBeInTheDocument(); expect(within(drawer).queryByText('ALMEX')).not.toBeInTheDocument();
  });

  it('opens the global drawer from the action URL and Cancelar clears only the action parameter', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 2, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts?action=new-contact&search=keep&page=2&pageSize=25');
    const drawer = await screen.findByRole('dialog');
    const companyInput = within(drawer).getByRole('combobox', { name: 'Empresa' });
    expect(companyInput).toBeVisible(); expect(companyInput).toHaveValue(''); expect(within(drawer).queryByText('ALMEX')).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent('?search=keep&page=2&pageSize=25');
    expect(screen.getByTestId('location')).not.toHaveTextContent('action=');
  });

  it('keeps the company fixed and hides autocomplete in contextual mode', async () => {
    await selectedPage(); const drawer = await contextualDrawer();
    expect(within(drawer).getByText('Empresa')).toBeInTheDocument(); expect(within(drawer).getByText('ALMEX')).toBeInTheDocument(); expect(within(drawer).queryByRole('combobox', { name: 'Empresa' })).not.toBeInTheDocument();
  });

  it('keeps an alias-only server result instead of filtering it by commercial name', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); companySearchMock.mockResolvedValue([lookup]); renderPage('/contacts'); const drawer = await globalDrawer(); const input = within(drawer).getByRole('combobox', { name: 'Empresa' });
    const user = userEvent.setup(); await user.click(input); await user.type(input, 'soluciones inte'); expect(companySearchMock).not.toHaveBeenCalled(); await waitFor(() => expect(companySearchMock).toHaveBeenCalledWith('soluciones inte'), { timeout: 2000 }); expect(await screen.findByRole('option', { name: /SILYM/ })).toBeInTheDocument(); expect(screen.getByText('Coincidencia por alias: SOLUCIONES INTEGRALES')).toBeInTheDocument();
  });

  it('requires an explicit result selection and posts that company ID', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); companySearchMock.mockResolvedValue([{ ...lookup, matchedAlias: null, commercialName: 'SOLUCIONES EN DESARROLLO' }]); createMock.mockResolvedValue({ contact: { id: '9' } as never, requestId: 'request-1' }); renderPage('/contacts?action=new-contact&search=keep&page=2'); const drawer = await screen.findByRole('dialog'); const form = within(drawer); const input = form.getByRole('combobox', { name: 'Empresa' });
    const user = userEvent.setup(); await user.click(input); await user.type(input, 'sol'); await waitFor(() => expect(companySearchMock).toHaveBeenCalledWith('sol')); fireEvent.click(await screen.findByText('SOLUCIONES EN DESARROLLO')); expect(screen.queryByText(/Coincidencia por alias:/)).not.toBeInTheDocument();
    fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: 'maria@example.test' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ companyId: '31', contactType: 'PERSONA', name: 'María', area: null, position: null, notes: null, methods: [{ type: 'CORREO', value: 'maria@example.test' }] })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(await screen.findByText('Contacto registrado correctamente.')).toBeInTheDocument(); expect(screen.getByTestId('location')).toHaveTextContent('search=keep&page=2'); expect(screen.getByTestId('location')).not.toHaveTextContent('action=');
  });

  it('does not submit typed but unselected company text and Cancelar clears it', async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0, totalPages: 0 } }); renderPage('/contacts'); const drawer = await globalDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('combobox', { name: 'Empresa' }), { target: { value: 'ALM' } }); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'María' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: 'maria@example.test' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' })); expect(await form.findByText('Selecciona una empresa existente.')).toBeInTheDocument(); expect(createMock).not.toHaveBeenCalled(); fireEvent.click(form.getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(createMock).not.toHaveBeenCalled();
  });

  it('retains contact form behavior, methods, contextual refresh, and URL state', async () => {
    createMock.mockResolvedValue({ contact: { id: '9' } as never, requestId: 'request-1' }); await selectedPage(); const drawer = await contextualDrawer(); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: ' María López ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Área' }), { target: { value: ' Compras ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: ' Compradora ' } }); fireEvent.change(form.getByRole('textbox', { name: 'Valor' }), { target: { value: ' maria@example.test ' } }); fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); fireEvent.click(form.getByRole('button', { name: 'Agregar medio' })); await selectMethodType(drawer, 1, 'Teléfono'); await selectMethodType(drawer, 2, 'WhatsApp'); const values = form.getAllByRole('textbox', { name: 'Valor' }); fireEvent.change(values[1]!, { target: { value: '+52 449 555 0101' } }); fireEvent.change(values[2]!, { target: { value: '+52 449 555 0102' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar contacto' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ companyId: '1', contactType: 'PERSONA', name: 'María López', area: 'Compras', position: 'Compradora', notes: null, methods: [{ type: 'CORREO', value: 'maria@example.test' }, { type: 'TELEFONO', value: '+52 449 555 0101' }, { type: 'WHATSAPP', value: '+52 449 555 0102' }] })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(detailMock.mock.calls.length).toBeGreaterThan(1); expect(listMock.mock.calls.length).toBeGreaterThan(1); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });
});

describe('ContactsPage contact method lifecycle', () => {
  it('shows Editar before Desactivar for an active method and lifecycle cancel sends no request', async () => {
    await lifecyclePage(contactDetail([activeMethod], []));
    expect(screen.queryByText('Medios inactivos (0)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` }));
    const edit = await screen.findByRole('menuitem', { name: 'Editar' }); const deactivate = screen.getByRole('menuitem', { name: 'Desactivar' }); expect(edit).toBeInTheDocument(); expect(edit.compareDocumentPosition(deactivate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument(); expect(screen.queryByText('Confirmar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar medio de contacto' });
    expect(within(dialog).getByText('Este medio dejará de aparecer como activo para este contacto. Podrás reactivarlo posteriormente.')).toBeInTheDocument();
    expect(within(dialog).getByText(`Correo: ${activeMethod.value}`)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(deactivateMock).not.toHaveBeenCalled();
  });

  it('deactivates the correct BIGINT method once, refreshes detail, and preserves URL state', async () => {
    let resolveRequest!: (value: never) => void;
    deactivateMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    const refreshed = contactDetail([], [activeMethod]);
    await lifecyclePage(contactDetail([activeMethod], []));
    detailMock.mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog'); const submit = within(dialog).getByRole('button', { name: 'Desactivar' }); fireEvent.click(submit); fireEvent.click(submit);
    expect(deactivateMock).toHaveBeenCalledTimes(1); expect(deactivateMock).toHaveBeenCalledWith('9007199254740993');
    resolveRequest({} as never);
    expect(await screen.findByText('Medio de contacto desactivado.')).toBeInTheDocument();
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Contacto Sintético')).toBeInTheDocument(); expect(screen.getByText('Sin medios activos')).toBeInTheDocument(); expect(screen.getByText('Medios inactivos (1)')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });

  it('keeps inactive methods collapsed, expands them, and reactivates without confirmation', async () => {
    reactivateMock.mockResolvedValue({} as never);
    await lifecyclePage(contactDetail([], [inactiveMethod]));
    const toggle = screen.getByRole('button', { name: 'Medios inactivos (1)' }); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(inactiveMethod.value)).not.toBeVisible(); fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByText(inactiveMethod.value)).toBeVisible();
    detailMock.mockResolvedValue(contactDetail([inactiveMethod], []));
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Otro: ${inactiveMethod.value}` }));
    expect(await screen.findByRole('menuitem', { name: 'Reactivar' })).toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivar' }));
    expect(reactivateMock).toHaveBeenCalledWith('9007199254740994'); expect(await screen.findByText('Medio de contacto reactivado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Medios inactivos (1)')).not.toBeInTheDocument()); expect(screen.getByText(inactiveMethod.value)).toBeVisible();
  });

  it('shows safe lifecycle errors without removing the contact', async () => {
    deactivateMock.mockRejectedValue(new Error('backend internals')); await lifecyclePage(contactDetail([activeMethod], []));
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Desactivar' })); fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('No fue posible desactivar el medio de contacto.')).toBeInTheDocument(); expect(screen.queryByText('backend internals')).not.toBeInTheDocument(); expect(screen.getByText('Contacto Sintético')).toBeInTheDocument();
  });
});

describe('ContactsPage contact method editing', () => {
  it('opens an active inline edit with persisted values and keeps it active after success', async () => {
    const corrected = { ...activeMethod, value: 'corrected@example.test' }; const refreshed = contactDetail([corrected], [inactivePhoneMethod]); editMethodMock.mockResolvedValue({ id: activeMethod.id, type: 'CORREO', value: corrected.value, status: 'ACTIVO' }); await lifecyclePage(contactDetail([activeMethod], [inactivePhoneMethod])); detailMock.mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); const edit = await screen.findByRole('menuitem', { name: 'Editar' }); expect(edit.compareDocumentPosition(screen.getByRole('menuitem', { name: 'Desactivar' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); fireEvent.click(edit);
    const form = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); expect(within(form).getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Correo'); expect(within(form).getByRole('textbox', { name: 'Valor' })).toHaveValue(activeMethod.value); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: corrected.value } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMethodMock).toHaveBeenCalledWith(activeMethod.id, { value: corrected.value })); expect(await screen.findByText('Medio de contacto actualizado.')).toBeInTheDocument(); expect(screen.queryByRole('form', { name: `Editar medio ${activeMethod.value}` })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: `Acciones para Correo: ${corrected.value}` })).toBeInTheDocument(); await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2)); expect(screen.getByRole('button', { name: 'Medios inactivos (1)' })).toBeInTheDocument(); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });

  it('shows Editar before Reactivar and keeps an edited method in the inactive section', async () => {
    const corrected = { ...inactivePhoneMethod, value: '+52 449 555 0199' }; const refreshed = contactDetail([activeMethod], [corrected]); editMethodMock.mockResolvedValue({ id: inactivePhoneMethod.id, type: 'TELEFONO', value: corrected.value, status: 'INACTIVO' }); await lifecyclePage(contactDetail([activeMethod], [inactivePhoneMethod])); detailMock.mockResolvedValue(refreshed); fireEvent.click(screen.getByRole('button', { name: 'Medios inactivos (1)' })); fireEvent.click(screen.getByRole('button', { name: `Acciones para Teléfono: ${inactivePhoneMethod.value}` }));
    const edit = await screen.findByRole('menuitem', { name: 'Editar' }); const reactivate = screen.getByRole('menuitem', { name: 'Reactivar' }); expect(edit.compareDocumentPosition(reactivate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); fireEvent.click(edit); const form = screen.getByRole('form', { name: `Editar medio ${inactivePhoneMethod.value}` }); expect(within(form).getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Teléfono'); expect(within(form).getByRole('textbox', { name: 'Valor' })).toHaveValue(inactivePhoneMethod.value); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: corrected.value } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMethodMock).toHaveBeenCalledWith(inactivePhoneMethod.id, { value: corrected.value })); expect(await screen.findByText('Medio de contacto actualizado.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Medios inactivos (1)' })).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByRole('button', { name: `Acciones para Teléfono: ${corrected.value}` })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })).toBeInTheDocument();
  });

  it('allows only one Add-or-Edit form and resets each form when another action opens', async () => {
    const secondMethod = { id: '9007199254740996', type: 'WHATSAPP' as const, value: '+52 449 555 0102', isPrimary: false }; await lifecyclePage(contactDetail([activeMethod, secondMethod], [])); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); const addForm = screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' }); fireEvent.change(within(addForm).getByRole('textbox', { name: 'Valor' }), { target: { value: 'unsaved@example.test' } }); fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    expect(screen.queryByRole('form', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument(); const firstEdit = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); fireEvent.change(within(firstEdit).getByRole('textbox', { name: 'Valor' }), { target: { value: 'unsaved-edit@example.test' } }); fireEvent.click(screen.getByRole('button', { name: `Acciones para WhatsApp: ${secondMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    expect(screen.queryByRole('form', { name: `Editar medio ${activeMethod.value}` })).not.toBeInTheDocument(); expect(within(screen.getByRole('form', { name: `Editar medio ${secondMethod.value}` })).getByRole('textbox', { name: 'Valor' })).toHaveValue(secondMethod.value); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' }));
    expect(screen.queryByRole('form', { name: `Editar medio ${secondMethod.value}` })).not.toBeInTheDocument(); expect(within(screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' })).getByRole('textbox', { name: 'Valor' })).toHaveValue(''); expect(editMethodMock).not.toHaveBeenCalled(); expect(addMethodMock).not.toHaveBeenCalled();
  });

  it('does not let an older PATCH completion close a newer Add form', async () => {
    let resolveEdit!: (value: { id: string; type: 'CORREO'; value: string; status: 'ACTIVO' }) => void; editMethodMock.mockReturnValue(new Promise((resolve) => { resolveEdit = resolve; })); await lifecyclePage(contactDetail([activeMethod], [])); fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' })); const editForm = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); fireEvent.change(within(editForm).getByRole('textbox', { name: 'Valor' }), { target: { value: 'corrected@example.test' } }); fireEvent.click(within(editForm).getByRole('button', { name: 'Guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); const addForm = screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' }); fireEvent.change(within(addForm).getByRole('textbox', { name: 'Valor' }), { target: { value: 'newer@example.test' } }); resolveEdit({ id: activeMethod.id, type: 'CORREO', value: 'corrected@example.test', status: 'ACTIVO' });
    expect(await screen.findByText('Medio de contacto actualizado.')).toBeInTheDocument(); expect(screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' })).toBeInTheDocument(); expect(within(screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' })).getByRole('textbox', { name: 'Valor' })).toHaveValue('newer@example.test');
  });

  it('does not let an older PATCH completion close a reopened editor for the same method', async () => {
    let resolveEdit!: (value: { id: string; type: 'CORREO'; value: string; status: 'ACTIVO' }) => void; editMethodMock.mockReturnValue(new Promise((resolve) => { resolveEdit = resolve; })); await lifecyclePage(contactDetail([activeMethod], [])); fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' })); const oldForm = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); fireEvent.change(within(oldForm).getByRole('textbox', { name: 'Valor' }), { target: { value: 'older@example.test' } }); fireEvent.click(within(oldForm).getByRole('button', { name: 'Guardar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' })); const reopened = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); fireEvent.change(within(reopened).getByRole('textbox', { name: 'Valor' }), { target: { value: 'newer@example.test' } }); resolveEdit({ id: activeMethod.id, type: 'CORREO', value: 'older@example.test', status: 'ACTIVO' });
    expect(await screen.findByText('Medio de contacto actualizado.')).toBeInTheDocument(); expect(screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` })).toBeInTheDocument(); expect(within(screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` })).getByRole('textbox', { name: 'Valor' })).toHaveValue('newer@example.test');
  });

  it('cancel restores the persisted row and sends no PATCH', async () => {
    await lifecyclePage(contactDetail([activeMethod], [])); fireEvent.click(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar' })); const form = screen.getByRole('form', { name: `Editar medio ${activeMethod.value}` }); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: 'unsaved@example.test' } }); fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: `Editar medio ${activeMethod.value}` })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })).toBeInTheDocument(); expect(screen.queryByText('unsaved@example.test')).not.toBeInTheDocument(); expect(editMethodMock).not.toHaveBeenCalled();
  });
});

describe('ContactsPage contact method creation', () => {
  it('places Agregar medio after active methods and keeps it available with zero active methods', async () => {
    await lifecyclePage(contactDetail([], [inactiveMethod]));
    const add = screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' }); const inactive = screen.getByRole('button', { name: 'Medios inactivos (1)' }); expect(screen.getByText('Sin medios activos')).toBeInTheDocument(); expect(add).toBeInTheDocument(); expect(inactive).toBeInTheDocument(); expect(add.compareDocumentPosition(inactive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); fireEvent.click(add); expect(screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' })).toBeInTheDocument(); expect(screen.queryByRole('dialog', { name: 'Agregar medio de contacto' })).not.toBeInTheDocument();
  });

  it('expands inline for the correct contact and cancel collapses without a request', async () => {
    await lifecyclePage(); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); const form = screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' });
    expect(screen.queryByRole('dialog', { name: 'Agregar medio de contacto' })).not.toBeInTheDocument(); fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' })); expect(screen.queryByRole('form', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })).toBeInTheDocument(); expect(addMethodMock).not.toHaveBeenCalled();
  });

  it('keeps only one form open and resets the first contact when another opens', async () => {
    const first = contactDetail().contacts[0]!; const second = { ...first, id: '21', name: 'Segundo Contacto' }; await lifecyclePage({ company: detail.company, contacts: [first, second], inactiveContacts: [] }); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); const firstForm = screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' }); fireEvent.change(within(firstForm).getByRole('textbox', { name: 'Valor' }), { target: { value: 'unsaved@example.test' } }); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Segundo Contacto' }));
    expect(screen.queryByRole('form', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })).toBeInTheDocument(); const secondForm = screen.getByRole('form', { name: 'Agregar medio para Segundo Contacto' }); expect(within(secondForm).getByRole('textbox', { name: 'Valor' })).toHaveValue(''); expect(screen.getAllByRole('form').filter((form) => form.getAttribute('aria-label')?.startsWith('Agregar medio para'))).toHaveLength(1);
  });

  it.each([
    ['CORREO', 'Correo', 'second@example.test'],
    ['TELEFONO', 'Teléfono', '+52 449 555 0301'],
    ['WHATSAPP', 'WhatsApp', '+52 449 555 0302']
  ] as const)('adds a second %s, refreshes detail, and preserves URL state', async (type, label, value) => {
    const first = { id: `first-${type}`, type, value: `first-${type}`, isPrimary: false }; const added = { id: `added-${type}`, type, value, status: 'ACTIVO' as const }; const initial = contactDetail([first], [inactiveMethod]); const refreshed = contactDetail([first, { ...added, isPrimary: false }], [inactiveMethod]);
    addMethodMock.mockResolvedValue(added); await lifecyclePage(initial); detailMock.mockResolvedValue(refreshed); fireEvent.click(screen.getByRole('button', { name: 'Agregar medio para Contacto Sintético' })); const form = screen.getByRole('form', { name: 'Agregar medio para Contacto Sintético' }); if (type !== 'CORREO') await selectMethodType(form, 0, label); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: ` ${value} ` } }); fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMethodMock).toHaveBeenCalledWith('20', { type, value })); expect(await screen.findByText('Medio de contacto agregado.')).toBeInTheDocument(); expect(screen.queryByRole('form', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument(); expect(screen.getByText(value)).toBeInTheDocument(); expect(screen.getByRole('button', { name: `Acciones para ${label}: ${value}` })).toBeInTheDocument(); await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2)); expect(screen.getByRole('button', { name: 'Medios inactivos (1)' })).toBeInTheDocument(); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });
});

describe('ContactsPage contact editing', () => {
  it('shows a distinct contact menu with Editar contacto and Desactivar contacto', async () => {
    await lifecyclePage(contactDetail([activeMethod], [])); expect(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' }));
    const edit = await screen.findByRole('menuitem', { name: 'Editar contacto' }); const deactivate = screen.getByRole('menuitem', { name: 'Desactivar contacto' }); expect(edit.compareDocumentPosition(deactivate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Eliminar')).not.toBeInTheDocument(); expect(screen.queryByText('Eliminar contacto')).not.toBeInTheDocument(); expect(screen.queryByText('Cambiar empresa')).not.toBeInTheDocument(); expect(screen.queryByText('Cambiar tipo')).not.toBeInTheDocument();
  });

  it('opens from the contact menu, refreshes on success, and preserves URL state', async () => {
    const initial = contactDetail([activeMethod], []); const refreshed = { ...initial, contacts: [{ ...initial.contacts[0]!, name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', position: null, notes: 'Nota actualizada' }] };
    updateMock.mockResolvedValue({ contact: { id: '20', companyId: '1', contactType: 'PERSONA', name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', position: null, notes: 'Nota actualizada', status: 'ACTIVO', isPrimary: false }, requestId: 'request-edit' });
    await lifecyclePage(initial); detailMock.mockResolvedValue(refreshed); fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' })); fireEvent.click(await screen.findByRole('menuitem', { name: 'Editar contacto' }));
    const drawer = await screen.findByRole('dialog'); const form = within(drawer); fireEvent.change(form.getByRole('textbox', { name: 'Nombre' }), { target: { value: 'Contacto Actualizado' } }); fireEvent.change(form.getByRole('textbox', { name: 'Área' }), { target: { value: 'Compras y Abastecimiento' } }); fireEvent.change(form.getByRole('textbox', { name: 'Cargo' }), { target: { value: '' } }); fireEvent.change(form.getByRole('textbox', { name: 'Observaciones' }), { target: { value: 'Nota actualizada' } }); fireEvent.click(form.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('20', { name: 'Contacto Actualizado', area: 'Compras y Abastecimiento', notes: 'Nota actualizada' }));
    expect(await screen.findByText('Contacto actualizado correctamente.')).toBeInTheDocument(); await waitFor(() => expect(screen.queryByText('Editar contacto')).not.toBeInTheDocument()); expect(screen.getByText('Contacto Actualizado')).toBeInTheDocument(); expect(screen.getByText('Compras y Abastecimiento')).toBeInTheDocument(); await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2)); expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });
});

describe('ContactsPage contact lifecycle', () => {
  it('opens a restrained confirmation and Cancelar leaves the contact active without requests', async () => {
    await lifecyclePage(contactDetail([activeMethod], []));
    fireEvent.click(await openContactMenu());
    const dialog = await screen.findByRole('dialog', { name: 'Desactivar contacto' });
    expect(within(dialog).getByText('Contacto Sintético dejará de aparecer entre los contactos activos de ALMEX. Sus medios de contacto se conservarán y podrás reactivar el contacto posteriormente.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeInTheDocument(); expect(within(dialog).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Desactivar contacto' })).not.toBeInTheDocument());
    expect(deactivateContactMock).not.toHaveBeenCalled(); expect(screen.getByText('Contacto Sintético')).toBeInTheDocument(); expect(screen.getByText('1 contacto')).toBeInTheDocument();
  });

  it('deactivates once, moves the contact to the collapsed inactive section, refreshes counts, and preserves URL state', async () => {
    deactivateContactMock.mockResolvedValue({} as never);
    const refreshed = { company: detail.company, contacts: [] as DirectoryContact[], inactiveContacts: [inactiveContactFixture([activeMethod], [inactiveMethod])] };
    await lifecyclePage(contactDetail([activeMethod], [inactiveMethod]));
    detailMock.mockResolvedValue(refreshed); listMock.mockResolvedValue({ data: [{ ...company, contactCount: 0 }], meta: listMeta });
    const submit = await deactivateViaMenu();
    fireEvent.click(submit); fireEvent.click(submit);
    expect(deactivateContactMock).toHaveBeenCalledTimes(1); expect(deactivateContactMock).toHaveBeenCalledWith('20');
    expect(await screen.findByText('Contacto desactivado.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Desactivar contacto' })).not.toBeInTheDocument());
    expect(screen.getByText('No hay contactos activos.')).toBeInTheDocument(); expect(screen.getAllByRole('button', { name: 'Agregar contacto' })).toHaveLength(2);
    const toggle = screen.getByRole('button', { name: 'Contactos inactivos (1)' }); expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(screen.getByText(activeMethod.value)).not.toBeVisible();
    fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(activeMethod.value)).toBeVisible(); expect(screen.getByRole('button', { name: 'Medios inactivos (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument();
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });

  it('shows a safe error, keeps the page usable, and does not get stuck when deactivation fails', async () => {
    deactivateContactMock.mockRejectedValue(new Error('SQLSTATE internals'));
    await lifecyclePage(contactDetail([activeMethod], []));
    const submit = await deactivateViaMenu(); fireEvent.click(submit);
    expect(await screen.findByText('No fue posible desactivar el contacto.')).toBeInTheDocument();
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument(); expect(screen.queryByText(/internals/)).not.toBeInTheDocument();
    expect(submit).toBeEnabled(); expect(screen.getByText('Contacto Sintético')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Desactivar contacto' })).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Desactivar contacto' })).not.toBeInTheDocument());
    expect(deactivateContactMock).toHaveBeenCalledTimes(1);
  });

  it('hides the inactive contacts section when empty', async () => {
    await lifecyclePage(contactDetail([activeMethod], []));
    expect(screen.queryByRole('button', { name: /Contactos inactivos/ })).not.toBeInTheDocument();
  });

  it('shows the populated inactive section collapsed with the correct count and expands it', async () => {
    const secondInactive = { ...inactiveContactFixture(), id: '21' };
    await lifecyclePage({ company: detail.company, contacts: [], inactiveContacts: [inactiveContactFixture(), secondInactive] });
    const toggle = screen.getByRole('button', { name: 'Contactos inactivos (2)' }); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    screen.getAllByText('Contacto Sintético').forEach((title) => expect(title).not.toBeVisible());
    fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true');
    screen.getAllByText('Contacto Sintético').forEach((title) => expect(title).toBeVisible());
  });

  it('offers only Reactivar contacto for an inactive contact and renders its methods read-only', async () => {
    reactivateContactMock.mockResolvedValue({} as never);
    const whatsappActive = { id: '9007199254740996', type: 'WHATSAPP' as const, value: '+52 449 555 0103', isPrimary: false };
    await lifecyclePage({ company: detail.company, contacts: [], inactiveContacts: [inactiveContactFixture([activeMethod, whatsappActive], [inactivePhoneMethod])] });
    fireEvent.click(screen.getByRole('button', { name: 'Contactos inactivos (1)' }));
    expect(screen.getByText('Compras')).toBeVisible();
    expect(screen.getByText(activeMethod.value)).toBeVisible(); expect(screen.getByText(whatsappActive.value)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Medios inactivos (1)' })); expect(screen.getByText(inactivePhoneMethod.value)).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Acciones para/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar medio para Contacto Sintético' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' }));
    const items = await screen.findAllByRole('menuitem'); expect(items).toHaveLength(1); expect(items[0]).toHaveTextContent('Reactivar contacto');
    expect(screen.queryByRole('menuitem', { name: 'Editar contacto' })).not.toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: 'Desactivar contacto' })).not.toBeInTheDocument();
    fireEvent.keyDown(items[0]!, { key: 'Escape' });
    expect(deactivateContactMock).not.toHaveBeenCalled(); expect(reactivateContactMock).not.toHaveBeenCalled(); expect(deactivateMock).not.toHaveBeenCalled(); expect(reactivateMock).not.toHaveBeenCalled();
  });

  it('reactivates immediately without confirmation, restores the active card, refreshes counts, and preserves URL state', async () => {
    reactivateContactMock.mockResolvedValue({} as never);
    await lifecyclePage({ company: detail.company, contacts: [], inactiveContacts: [inactiveContactFixture([activeMethod], [inactiveMethod])] });
    const refreshed = contactDetail([activeMethod], [inactiveMethod]);
    listMock.mockResolvedValue({ data: [{ ...company, contactCount: 1 }], meta: listMeta }); detailMock.mockResolvedValue(refreshed);
    fireEvent.click(screen.getByRole('button', { name: 'Contactos inactivos (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' }));
    const reactivateItem = await screen.findByRole('menuitem', { name: 'Reactivar contacto' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(reactivateItem);
    expect(reactivateContactMock).toHaveBeenCalledWith('20');
    expect(await screen.findByText('Contacto reactivado.')).toBeInTheDocument();
    expect(await screen.findByText('1 contacto')).toBeInTheDocument();
    expect(screen.getByText(activeMethod.value)).toBeVisible();
    expect(screen.getByRole('button', { name: `Acciones para Correo: ${activeMethod.value}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Acciones del contacto Contacto Sintético` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Contactos inactivos/ })).not.toBeInTheDocument();
    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('location')).toHaveTextContent('company=1&search=almex&page=2&pageSize=25');
  });

  it('shows a safe error and keeps the inactive section usable when reactivation fails', async () => {
    reactivateContactMock.mockRejectedValue(new Error('backend internals'));
    await lifecyclePage({ company: detail.company, contacts: [], inactiveContacts: [inactiveContactFixture()] });
    fireEvent.click(screen.getByRole('button', { name: 'Contactos inactivos (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Acciones del contacto Contacto Sintético' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reactivar contacto' }));
    expect(await screen.findByText('No fue posible reactivar el contacto.')).toBeInTheDocument();
    expect(screen.queryByText(/internals/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contactos inactivos (1)' })).toBeInTheDocument();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});

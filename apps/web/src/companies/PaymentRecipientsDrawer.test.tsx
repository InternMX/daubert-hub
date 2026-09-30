import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactApiError } from '../services/contacts';
import type { DirectoryCompanyDetail, DirectoryContact, DirectoryContactMethod } from '../services/contactDirectory';
import { CompanyPaymentNotificationSettingsSection } from './CompanyPaymentNotificationSettingsSection';

const api = vi.hoisted(() => ({ getDirectory: vi.fn(), editMethod: vi.fn(), addMethod: vi.fn(), createContact: vi.fn(), getSettings: vi.fn() }));

vi.mock('../services/contactDirectory', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactDirectory')>()), getContactDirectoryCompany: api.getDirectory }));
vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), editContactMethod: api.editMethod, addContactMethod: api.addMethod }));
vi.mock('../services/contacts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contacts')>()), createContact: api.createContact }));
vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()), getPaymentNotificationSettings: api.getSettings }));

// BIGINT-sized ids: they must travel as strings end to end.
const COMPANY = '9007199254740993123';
const ANA = '9007199254740993201';
const LUIS = '9007199254740993202';
const M_ANA = '9007199254740993301';
const M_LUIS = '9007199254740993302';

const settings = (ready: boolean) => ({ companyId: COMPANY, dropboxPath: 'PROVEEDORES/NOVAPAK', processesPaymentReceipts: true, notificationsActive: false, destinationPath: 'PROVEEDORES\\NOVAPAK\\PAGOS', readiness: { ready, missingRequirements: ready ? [] : ['PAYMENT_RECIPIENT_PARA_REQUIRED' as const] } });
const method = (id: string, value: string, extra: Partial<DirectoryContactMethod> = {}): DirectoryContactMethod => ({ id, type: 'CORREO', value, isPrimary: false, receivesPaymentNotifications: false, paymentRecipientType: null, ...extra });
const contact = (id: string, name: string, methods: DirectoryContactMethod[], extra: Partial<DirectoryContact> = {}): DirectoryContact => ({ id, name, contactType: 'PERSONA', area: null, position: null, notes: null, isPrimary: false, methods, inactiveMethods: [], ...extra });
const directory = (contacts: DirectoryContact[], inactiveContacts: DirectoryContact[] = []): DirectoryCompanyDetail => ({ company: { id: COMPANY, commercialName: 'Novapak', companyType: 'PROVEEDOR' }, contacts, inactiveContacts });

function renderSection() { return render(<CompanyPaymentNotificationSettingsSection companyId={COMPANY} />); }
async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Configurar destinatarios' }));
  return screen.findByRole('dialog', { name: 'Destinatarios de notificaciones de pago' });
}
async function pick(user: ReturnType<typeof userEvent.setup>, panel: HTMLElement, email: string, option: string) {
  await user.click(within(panel).getByRole('combobox', { name: new RegExp(email.replace('.', '\\.')) }));
  await user.click(await screen.findByRole('option', { name: option }));
}

beforeEach(() => {
  api.getSettings.mockResolvedValue(settings(false));
  api.getDirectory.mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com')])]));
});
afterEach(() => vi.clearAllMocks());

describe('Configurar destinatarios — acceso', () => {
  it('aparece cuando el backend informa que falta el destinatario PARA, en la sección normal (sin ningún estado de flujo guiado)', async () => {
    renderSection();
    expect(await screen.findByRole('button', { name: 'Configurar destinatarios' })).toBeInTheDocument();
    expect(api.getDirectory).not.toHaveBeenCalled(); // no carga nada hasta abrir el panel
  });

  it('no aparece cuando el backend no pide PARA (lista) ni cuando faltan solo otros requisitos', async () => {
    api.getSettings.mockResolvedValue(settings(true));
    const { unmount } = renderSection();
    await screen.findByText('Lista para activar');
    expect(screen.queryByRole('button', { name: 'Configurar destinatarios' })).not.toBeInTheDocument();
    unmount();
    api.getSettings.mockResolvedValue({ ...settings(false), readiness: { ready: false, missingRequirements: ['DROPBOX_PATH_REQUIRED'] } });
    renderSection();
    await screen.findByText('Faltan requisitos');
    expect(screen.queryByRole('button', { name: 'Configurar destinatarios' })).not.toBeInTheDocument();
  });
});

describe('Panel de destinatarios — contenido', () => {
  it('muestra solo contactos activos y sus correos activos, con No recibe / PARA / CC / CCO según lo persistido', async () => {
    api.getDirectory.mockResolvedValue(directory(
      [
        contact(ANA, 'Ana Pérez', [
          method(M_ANA, 'ana@novapak.com'),
          method('9007199254740993303', 'ana.para@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' }),
          method('9007199254740993304', 'ana.cc@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'CC' }),
          method('9007199254740993305', 'ana.cco@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'CCO' }),
          method('9007199254740993306', '4491234567', { type: 'TELEFONO' })
        ], { inactiveMethods: [method('9007199254740993307', 'viejo@novapak.com')] }),
        contact(LUIS, 'Luis Gómez', [])
      ],
      [contact('9007199254740993203', 'Inactivo Pérez', [method('9007199254740993308', 'inactivo@novapak.com')])]
    ));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    expect(await within(panel).findByText('ana@novapak.com')).toBeInTheDocument();
    expect(within(panel).getByText('Notificaciones de pago: no recibe')).toBeInTheDocument();
    expect(within(panel).getByText('Notificaciones de pago: PARA')).toBeInTheDocument();
    expect(within(panel).getByText('Notificaciones de pago: CC')).toBeInTheDocument();
    expect(within(panel).getByText('Notificaciones de pago: CCO')).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: /ana\.para@novapak\.com/ })).toHaveTextContent('PARA');
    expect(within(panel).getByRole('combobox', { name: /ana\.cc@novapak\.com/ })).toHaveTextContent('CC');
    expect(within(panel).getByRole('combobox', { name: /ana\.cco@novapak\.com/ })).toHaveTextContent('CCO');
    expect(within(panel).getByRole('combobox', { name: /ana@novapak\.com/ })).toHaveTextContent('No recibe');
    expect(within(panel).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(panel).getByText('Luis Gómez')).toBeInTheDocument();
    expect(within(panel).getByText('Sin correos activos.')).toBeInTheDocument();
    // Ni teléfonos, ni métodos inactivos, ni contactos inactivos.
    expect(within(panel).queryByText('4491234567')).not.toBeInTheDocument();
    expect(within(panel).queryByText('viejo@novapak.com')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Inactivo Pérez')).not.toBeInTheDocument();
    expect(within(panel).queryByText('inactivo@novapak.com')).not.toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledWith(COMPANY);
  });

  it('un PARA/CC/CCO inconsistente (recibe=false con tipo) se muestra como No recibe: solo cuenta lo persistido', async () => {
    api.getDirectory.mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com', { receivesPaymentNotifications: false, paymentRecipientType: 'CC' })])]));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    expect(await within(panel).findByText('Notificaciones de pago: no recibe')).toBeInTheDocument();
  });

  it('proveedor sin contactos: mensaje vacío y la opción de agregar contacto', async () => {
    api.getDirectory.mockResolvedValue(directory([]));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    expect(await within(panel).findByText(/aún no tiene contactos activos/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Agregar contacto' })).toBeInTheDocument();
  });

  it('un error al cargar el directorio se informa con reintento', async () => {
    api.getDirectory.mockRejectedValueOnce(new Error('x'));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    expect(await within(panel).findByText('No fue posible cargar los contactos de esta empresa.')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Reintentar' }));
    expect(await within(panel).findByText('ana@novapak.com')).toBeInTheDocument();
  });
});

describe('Panel de destinatarios — cambio de tipo (API existente de métodos de contacto)', () => {
  it('No recibe -> PARA envía receivesPaymentNotifications:true + paymentRecipientType:PARA con el id como string', async () => {
    api.editMethod.mockResolvedValue({ id: M_ANA, type: 'CORREO', value: 'ana@novapak.com', status: 'ACTIVO' });
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'PARA');
    await waitFor(() => expect(api.editMethod).toHaveBeenCalledTimes(1));
    expect(api.editMethod).toHaveBeenCalledWith(M_ANA, { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    expect(typeof api.editMethod.mock.calls[0]![0]).toBe('string');
  });

  it('PARA -> CC envía el nuevo tipo', async () => {
    api.getDirectory.mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })])]));
    api.editMethod.mockResolvedValue({});
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'CC');
    await waitFor(() => expect(api.editMethod).toHaveBeenCalledWith(M_ANA, { receivesPaymentNotifications: true, paymentRecipientType: 'CC' }));
  });

  it('CC -> No recibe envía solo receivesPaymentNotifications:false (sin tipo)', async () => {
    api.getDirectory.mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'CC' })])]));
    api.editMethod.mockResolvedValue({});
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'No recibe');
    await waitFor(() => expect(api.editMethod).toHaveBeenCalledWith(M_ANA, { receivesPaymentNotifications: false }));
    expect(api.editMethod.mock.calls[0]![1]).not.toHaveProperty('paymentRecipientType');
  });

  it('elegir el valor que ya está persistido no llama a la API', async () => {
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'No recibe');
    expect(api.editMethod).not.toHaveBeenCalled();
  });
});

describe('Panel de destinatarios — refresh y readiness (siempre del backend)', () => {
  it('tras cambiar un destinatario recarga el directorio y vuelve a consultar settings: ready false -> true se refleja sin recargar la página', async () => {
    api.getSettings.mockResolvedValueOnce(settings(false)).mockResolvedValue(settings(true));
    api.getDirectory
      .mockResolvedValueOnce(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com')])]))
      .mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })])]));
    api.editMethod.mockResolvedValue({});
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText('Faltan requisitos')).toBeInTheDocument();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'PARA');
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(screen.queryByText('Faltan requisitos')).not.toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalledTimes(2);
    expect(api.getDirectory).toHaveBeenCalledTimes(2);
    // El panel sigue abierto y ya muestra el valor persistido.
    expect(await within(panel).findByText('Notificaciones de pago: PARA')).toBeInTheDocument();
    expect(within(panel).getByRole('combobox', { name: /ana@novapak\.com/ })).toHaveTextContent('PARA');
  });

  it('el refresh de settings es silencioso: la sección no vuelve a mostrar el indicador de carga', async () => {
    api.editMethod.mockResolvedValue({});
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'PARA');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('progressbar', { name: 'Cargando configuración de notificaciones de pago' })).not.toBeInTheDocument();
  });

  it('409 PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA: mensaje seguro existente, el valor persistido se conserva y settings no se vuelve a consultar', async () => {
    api.getDirectory.mockResolvedValue(directory([contact(ANA, 'Ana Pérez', [method(M_ANA, 'ana@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })])]));
    api.editMethod.mockRejectedValue(new ContactApiError(409, 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', 'req-9'));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'No recibe');
    expect(await within(panel).findByText(/último destinatario PARA de una empresa con Notificaciones de Pago activas/)).toBeInTheDocument();
    await waitFor(() => expect(api.getDirectory).toHaveBeenCalledTimes(2)); // recarga para no dejar un estado falso
    expect(within(panel).getByRole('combobox', { name: /ana@novapak\.com/ })).toHaveTextContent('PARA');
    expect(within(panel).getByText('Notificaciones de pago: PARA')).toBeInTheDocument();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('un error genérico al guardar muestra un aviso y conserva lo persistido', async () => {
    api.editMethod.mockRejectedValue(new ContactApiError(500, undefined, 'req-1'));
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await pick(user, panel, 'ana@novapak.com', 'CCO');
    expect(await within(panel).findByText('No fue posible actualizar el destinatario. Inténtalo nuevamente.')).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: /ana@novapak\.com/ })).toHaveTextContent('No recibe'));
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });
});

describe('Panel de destinatarios — crear datos faltantes en el mismo contexto', () => {
  it('agrega un correo a un contacto existente con la UI existente, directamente como PARA, y refresca readiness', async () => {
    api.getSettings.mockResolvedValueOnce(settings(false)).mockResolvedValue(settings(true));
    api.getDirectory
      .mockResolvedValueOnce(directory([contact(LUIS, 'Luis Gómez', [])]))
      .mockResolvedValue(directory([contact(LUIS, 'Luis Gómez', [method(M_LUIS, 'luis@novapak.com', { receivesPaymentNotifications: true, paymentRecipientType: 'PARA' })])]));
    api.addMethod.mockResolvedValue({ id: M_LUIS, type: 'CORREO', value: 'luis@novapak.com', status: 'ACTIVO', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await user.click(await within(panel).findByRole('button', { name: 'Agregar correo para Luis Gómez' }));
    const form = within(panel).getByRole('form', { name: 'Agregar medio para Luis Gómez' });
    await user.type(within(form).getByRole('textbox', { name: 'Valor' }), 'luis@novapak.com');
    await user.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    await user.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(api.addMethod).toHaveBeenCalledTimes(1));
    expect(api.addMethod).toHaveBeenCalledWith(LUIS, { type: 'CORREO', value: 'luis@novapak.com', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    expect(typeof api.addMethod.mock.calls[0]![0]).toBe('string');
    expect(await screen.findByText('Lista para activar')).toBeInTheDocument();
    expect(await within(panel).findByText('luis@novapak.com')).toBeInTheDocument();
    expect(api.getDirectory).toHaveBeenCalledTimes(2);
  });

  it('agrega un correo como CC usando el selector existente de tipo de destinatario', async () => {
    api.addMethod.mockResolvedValue({ id: M_LUIS, type: 'CORREO', value: 'cc@novapak.com', status: 'ACTIVO' });
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await user.click(await within(panel).findByRole('button', { name: 'Agregar correo para Ana Pérez' }));
    const form = within(panel).getByRole('form', { name: 'Agregar medio para Ana Pérez' });
    await user.type(within(form).getByRole('textbox', { name: 'Valor' }), 'cc@novapak.com');
    await user.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    await user.click(within(form).getByRole('combobox', { name: /Tipo de destinatario/ }));
    await user.click(await screen.findByRole('option', { name: 'CC' }));
    await user.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(api.addMethod).toHaveBeenCalledWith(ANA, { type: 'CORREO', value: 'cc@novapak.com', receivesPaymentNotifications: true, paymentRecipientType: 'CC' }));
  });

  it('crea un contacto nuevo con la empresa FIJA (sin autocomplete) y refresca contactos y readiness', async () => {
    api.createContact.mockResolvedValue({ contact: { id: '9007199254740993999' }, requestId: 'r' });
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await within(panel).findByText('ana@novapak.com');
    await user.click(within(panel).getByRole('button', { name: 'Agregar contacto' }));
    const drawer = await screen.findByRole('heading', { name: 'Agregar contacto' });
    const form = drawer.closest('form') as HTMLElement;
    // Empresa fija: se muestra el nombre del proveedor y NO existe el buscador de empresas.
    expect(within(form).getByText('Novapak')).toBeInTheDocument();
    expect(within(form).queryByRole('combobox', { name: /Empresa/ })).not.toBeInTheDocument();
    expect(within(form).queryByPlaceholderText('Buscar empresa...')).not.toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: /Nombre/ }), 'Marta Ruiz');
    await user.type(within(form).getByRole('textbox', { name: 'Valor' }), 'marta@novapak.com');
    await user.click(within(form).getByRole('button', { name: 'Guardar contacto' }));
    await waitFor(() => expect(api.createContact).toHaveBeenCalledTimes(1));
    expect(api.createContact).toHaveBeenCalledWith({ companyId: COMPANY, contactType: 'PERSONA', name: 'Marta Ruiz', area: null, position: null, notes: null, methods: [{ type: 'CORREO', value: 'marta@novapak.com' }] });
    expect(typeof api.createContact.mock.calls[0]![0].companyId).toBe('string');
    await waitFor(() => expect(api.getDirectory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });
});

describe('Panel de destinatarios — cerrar / cancelar', () => {
  it('cerrar con la X o con "Cerrar" no realiza ninguna mutación ni consulta settings de nuevo', async () => {
    const user = userEvent.setup();
    renderSection();
    let panel = await openPanel(user);
    await screen.findByText('ana@novapak.com');
    await user.click(within(panel).getAllByRole('button', { name: 'Cerrar' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).not.toBeInTheDocument());
    panel = await openPanel(user);
    await user.click(within(panel).getAllByRole('button', { name: 'Cerrar' })[1]!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Destinatarios de notificaciones de pago' })).not.toBeInTheDocument());
    expect(api.editMethod).not.toHaveBeenCalled();
    expect(api.addMethod).not.toHaveBeenCalled();
    expect(api.createContact).not.toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('cancelar el formulario de agregar correo no muta nada', async () => {
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await user.click(await within(panel).findByRole('button', { name: 'Agregar correo para Ana Pérez' }));
    const form = within(panel).getByRole('form', { name: 'Agregar medio para Ana Pérez' });
    await user.type(within(form).getByRole('textbox', { name: 'Valor' }), 'x@novapak.com');
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(within(panel).queryByRole('form', { name: 'Agregar medio para Ana Pérez' })).not.toBeInTheDocument();
    expect(api.addMethod).not.toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('cancelar el alta de contacto no crea nada', async () => {
    const user = userEvent.setup();
    renderSection();
    const panel = await openPanel(user);
    await within(panel).findByText('ana@novapak.com');
    await user.click(within(panel).getByRole('button', { name: 'Agregar contacto' }));
    const heading = await screen.findByRole('heading', { name: 'Agregar contacto' });
    await user.click(within(heading.closest('form') as HTMLElement).getByRole('button', { name: 'Cancelar' }));
    expect(api.createContact).not.toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });
});

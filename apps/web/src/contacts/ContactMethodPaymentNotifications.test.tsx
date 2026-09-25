import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addContactMethod, editContactMethod } from '../services/contactMethods';
import { AddContactMethodForm } from './AddContactMethodForm';
import { ContactMethodRow } from './ContactMethodRow';
import { EditContactMethodForm, type EditableDirectoryContactMethod } from './EditContactMethodForm';

vi.mock('../services/contactMethods', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/contactMethods')>()),
  addContactMethod: vi.fn(),
  editContactMethod: vi.fn()
}));
const addMock = vi.mocked(addContactMethod);
const editMock = vi.mocked(editContactMethod);

const contact = { id: '9007199254740993', label: 'María López' };
const created = { id: '205', type: 'CORREO' as const, value: 'pagos@example.test', status: 'ACTIVO' as const };
const email: EditableDirectoryContactMethod = { id: '9007199254740994', type: 'CORREO', value: 'pagos@example.test', isPrimary: false, receivesPaymentNotifications: false, paymentRecipientType: null };

afterEach(() => vi.clearAllMocks());

function renderAdd() {
  render(<AddContactMethodForm contact={contact} onClose={vi.fn()} onAdded={vi.fn()} />);
  return screen.getByRole('form', { name: 'Agregar medio para María López' });
}
function renderEdit(method: EditableDirectoryContactMethod = email) {
  render(<EditContactMethodForm method={method} onClose={vi.fn()} onEdited={vi.fn()} />);
  return screen.getByRole('form', { name: `Editar medio ${method.value}` });
}
async function chooseRecipient(form: HTMLElement, label: string) {
  fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo de destinatario' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
async function selectMethodType(form: HTMLElement, label: string) {
  fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo' }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}
function type(form: HTMLElement, value: string) {
  fireEvent.change(within(form).getByRole('textbox', { name: /Valor|URL/ }), { target: { value } });
}

describe('AddContactMethodForm — payment notifications', () => {
  it('for CORREO shows "Correo principal" and "Recibe notificaciones de pago", both off, and no recipient type yet', () => {
    const form = renderAdd();
    expect(within(form).getByRole('checkbox', { name: 'Correo principal' })).not.toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' })).not.toBeChecked();
    expect(within(form).getByText('Notificaciones de Pago')).toBeInTheDocument();
    expect(within(form).queryByRole('combobox', { name: 'Tipo de destinatario' })).not.toBeInTheDocument();
  });

  it('a normal email (nothing checked) submits the plain payload — no payment fields', async () => {
    addMock.mockResolvedValue(created);
    const form = renderAdd();
    type(form, 'pagos@example.test');
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(contact.id, { type: 'CORREO', value: 'pagos@example.test' }));
  });

  it.each(['PARA', 'CC', 'CCO'])('CORREO + %s submits receivesPaymentNotifications with that type', async (recipient) => {
    addMock.mockResolvedValue(created);
    const form = renderAdd();
    type(form, 'pagos@example.test');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    await chooseRecipient(form, recipient);
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(contact.id, { type: 'CORREO', value: 'pagos@example.test', receivesPaymentNotifications: true, paymentRecipientType: recipient }));
  });

  it('checking "Recibe" preselects PARA; unchecking clears the type so nothing is sent', async () => {
    addMock.mockResolvedValue(created);
    const form = renderAdd();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    expect(within(form).getByRole('combobox', { name: 'Tipo de destinatario' })).toHaveTextContent('PARA');
    await chooseRecipient(form, 'CC');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    expect(within(form).queryByRole('combobox', { name: 'Tipo de destinatario' })).not.toBeInTheDocument();
    type(form, 'pagos@example.test');
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(contact.id, { type: 'CORREO', value: 'pagos@example.test' }));
  });

  it('"Correo principal" and PARA are independent: principal alone does not send PARA, PARA alone does not send principal', async () => {
    addMock.mockResolvedValue(created);
    let form = renderAdd();
    type(form, 'a@example.test');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Correo principal' }));
    expect(within(form).queryByRole('combobox', { name: 'Tipo de destinatario' })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenLastCalledWith(contact.id, { type: 'CORREO', value: 'a@example.test', isPrimary: true }));

    document.body.innerHTML = '';
    form = renderAdd();
    type(form, 'b@example.test');
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    expect(within(form).getByRole('checkbox', { name: 'Correo principal' })).not.toBeChecked();
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenLastCalledWith(contact.id, { type: 'CORREO', value: 'b@example.test', receivesPaymentNotifications: true, paymentRecipientType: 'PARA' }));
  });

  it('hides every payment control for non-email types and never sends payment fields for them', async () => {
    addMock.mockResolvedValue({ ...created, type: 'TELEFONO', value: '449 555 0100' });
    const form = renderAdd();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    await selectMethodType(form, 'Teléfono');
    expect(within(form).queryByRole('checkbox', { name: 'Recibe notificaciones de pago' })).not.toBeInTheDocument();
    expect(within(form).queryByRole('checkbox', { name: 'Correo principal' })).not.toBeInTheDocument();
    expect(within(form).queryByText('Notificaciones de Pago')).not.toBeInTheDocument();
    type(form, '449 555 0100');
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(contact.id, { type: 'TELEFONO', value: '449 555 0100' }));
  });

  it('keeps the BIGINT contact id as a string in the request', async () => {
    addMock.mockResolvedValue(created);
    const form = renderAdd();
    type(form, 'pagos@example.test');
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock.mock.calls[0]![0]).toBe('9007199254740993'));
  });
});

describe('EditContactMethodForm — payment notifications', () => {
  const edited = { id: email.id, type: 'CORREO' as const, value: email.value, status: 'ACTIVO' as const };

  it('preloads the persisted flags and stays unchanged (Guardar disabled)', () => {
    const form = renderEdit({ ...email, isPrimary: true, receivesPaymentNotifications: true, paymentRecipientType: 'CC' });
    expect(within(form).getByRole('checkbox', { name: 'Correo principal' })).toBeChecked();
    expect(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' })).toBeChecked();
    expect(within(form).getByRole('combobox', { name: 'Tipo de destinatario' })).toHaveTextContent('CC');
    expect(within(form).getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it.each(['PARA', 'CC', 'CCO'])('turning on "Recibe" with %s sends only the payment fields', async (recipient) => {
    editMock.mockResolvedValue(edited);
    const form = renderEdit();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    await chooseRecipient(form, recipient);
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(email.id, { receivesPaymentNotifications: true, paymentRecipientType: recipient }));
  });

  it('turning "Recibe" off sends receivesPaymentNotifications=false with no recipient type (the type is cleared)', async () => {
    editMock.mockResolvedValue(edited);
    const form = renderEdit({ ...email, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    expect(within(form).queryByRole('combobox', { name: 'Tipo de destinatario' })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(email.id, { receivesPaymentNotifications: false }));
  });

  it('principal and PARA are independent: changing one never changes the other', async () => {
    editMock.mockResolvedValue(edited);
    const form = renderEdit({ ...email, isPrimary: true, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Correo principal' }));
    expect(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' })).toBeChecked();
    expect(within(form).getByRole('combobox', { name: 'Tipo de destinatario' })).toHaveTextContent('PARA');
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(email.id, { isPrimary: false }));
  });

  it('changing only the recipient type keeps "Recibe" on and sends both fields', async () => {
    editMock.mockResolvedValue(edited);
    const form = renderEdit({ ...email, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    await chooseRecipient(form, 'CCO');
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(email.id, { receivesPaymentNotifications: true, paymentRecipientType: 'CCO' }));
  });

  it('switching the method to a non-email type hides the payment controls and sends no payment fields', async () => {
    editMock.mockResolvedValue({ ...edited, type: 'TELEFONO', value: '449 555 0100' });
    const form = renderEdit({ ...email, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    await selectMethodType(form, 'Teléfono');
    expect(within(form).queryByRole('checkbox', { name: 'Recibe notificaciones de pago' })).not.toBeInTheDocument();
    type(form, '449 555 0100');
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(email.id, { type: 'TELEFONO', value: '449 555 0100' }));
  });

  it('a non-email method shows no payment controls at all', () => {
    const form = renderEdit({ id: '5', type: 'TELEFONO', value: '449 555 0100', isPrimary: false });
    expect(within(form).queryByText('Notificaciones de Pago')).not.toBeInTheDocument();
  });

  it('a method loaded without the new fields (older payload) is treated as "does not receive"', () => {
    const form = renderEdit({ id: '6', type: 'CORREO', value: 'old@example.test', isPrimary: false });
    expect(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' })).not.toBeChecked();
  });
});

describe('ContactMethodRow — payment notification badges', () => {
  function renderRow(method: Parameters<typeof ContactMethodRow>[0]['method']) {
    render(<ContactMethodRow method={method} pending={false} readOnly />);
  }

  it('shows "Correo principal" and the recipient type independently', () => {
    renderRow({ id: '1', type: 'CORREO', value: 'a@example.test', isPrimary: true, receivesPaymentNotifications: false, paymentRecipientType: null });
    expect(screen.getByText('Correo principal')).toBeInTheDocument();
    expect(screen.queryByText(/Pago:/)).not.toBeInTheDocument();
  });

  it.each(['PARA', 'CC', 'CCO'] as const)('shows the %s recipient badge without implying a principal email', (recipient) => {
    renderRow({ id: '1', type: 'CORREO', value: 'a@example.test', isPrimary: false, receivesPaymentNotifications: true, paymentRecipientType: recipient });
    expect(screen.getByText(`Pago: ${recipient}`)).toBeInTheDocument();
    expect(screen.queryByText('Correo principal')).not.toBeInTheDocument();
  });

  it('a plain email and a phone number show no badges, even if a stale flag is present on the phone', () => {
    renderRow({ id: '1', type: 'CORREO', value: 'a@example.test', isPrimary: false });
    expect(screen.queryByText(/Pago:|Correo principal/)).not.toBeInTheDocument();
    document.body.innerHTML = '';
    renderRow({ id: '2', type: 'TELEFONO', value: '449 555 0100', isPrimary: true, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    expect(screen.queryByText(/Pago:|Correo principal/)).not.toBeInTheDocument();
  });

  it('does not show a recipient badge when the type is present but "receives" is false', () => {
    renderRow({ id: '1', type: 'CORREO', value: 'a@example.test', isPrimary: false, receivesPaymentNotifications: false, paymentRecipientType: 'PARA' });
    expect(screen.queryByText(/Pago:/)).not.toBeInTheDocument();
  });
});

describe('EditContactMethodForm — last PARA guard', () => {
  it('shows the backend-driven message (no local prediction) when the change would remove the last PARA', async () => {
    const { ContactApiError } = await import('../services/contacts');
    editMock.mockRejectedValue(new ContactApiError(409, 'PAYMENT_NOTIFICATIONS_ACTIVE_REQUIRES_PARA', 'req-1'));
    const form = renderEdit({ ...email, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(form).findByText(/último destinatario PARA de una empresa con Notificaciones de Pago activas/)).toBeInTheDocument();
    expect(within(form).getByText(/desactiva primero las Notificaciones de Pago/)).toBeInTheDocument();
    // The form stays open and editable (nothing was saved).
    expect(within(form).getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });

  it('is never blocked locally: with no backend error the request is always sent', async () => {
    editMock.mockResolvedValue({ id: email.id, type: 'CORREO', value: email.value, status: 'ACTIVO' });
    const form = renderEdit({ ...email, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Recibe notificaciones de pago' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledOnce());
  });
});

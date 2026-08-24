import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactApiError } from '../services/contacts';
import { addContactMethod } from '../services/contactMethods';
import { AddContactMethodForm } from './AddContactMethodForm';

vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), addContactMethod: vi.fn() }));
const addMock = vi.mocked(addContactMethod);
const contact = { id: '9007199254740993', label: 'María López' };
const created = { id: '205', type: 'CORREO' as const, value: 'second@example.test', status: 'ACTIVO' as const };
function renderForm(onClose = vi.fn(), onAdded = vi.fn()) { render(<AddContactMethodForm contact={contact} onClose={onClose} onAdded={onAdded} />); return { form: screen.getByRole('form', { name: 'Agregar medio para María López' }), onClose, onAdded }; }
async function selectType(form: HTMLElement, label: string) { fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo' })); fireEvent.click(await screen.findByRole('option', { name: label })); }

afterEach(() => vi.clearAllMocks());

describe('AddContactMethodForm', () => {
  it('renders inline without a dialog, defaults to Correo, and offers supported types without OTRO', async () => {
    const { form } = renderForm();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Correo');
    expect(within(form).getByPlaceholderText('correo@empresa.com')).toBeInTheDocument();
    fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo' }));
    expect(await screen.findByRole('option', { name: 'Correo' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Teléfono' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'WhatsApp' })).toBeInTheDocument(); expect(screen.queryByRole('option', { name: 'OTRO' })).not.toBeInTheDocument();
  });

  it('cancel closes, clears unsaved state, and sends no POST', () => {
    const onClose = vi.fn(); render(<AddContactMethodForm contact={contact} onClose={onClose} onAdded={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Valor' }), { target: { value: 'unsaved@example.test' } }); fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledOnce(); expect(addMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('');
  });

  it.each([
    ['', 'Ingresa un valor.'],
    ['not-an-email', 'Ingresa un correo válido.']
  ])('rejects invalid correo value %s', async (value, message) => {
    const { form } = renderForm(); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value } }); fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    expect(await within(form).findByText(message)).toBeInTheDocument(); expect(addMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Teléfono', 'TELEFONO', '+52 (449) 123-4567 ext. 204'],
    ['WhatsApp', 'WHATSAPP', '+52 449 123 4567']
  ] as const)('accepts a valid %s', async (label, type, value) => {
    addMock.mockResolvedValue({ ...created, type, value }); const { form, onAdded } = renderForm(); await selectType(form, label); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: ` ${value} ` } }); fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addMock).toHaveBeenCalledWith(contact.id, { type, value })); expect(onAdded).toHaveBeenCalledWith(contact.id, expect.objectContaining({ type, value }));
  });

  it('clears stale value when the type changes', async () => {
    const { form } = renderForm(); const input = within(form).getByRole('textbox', { name: 'Valor' }); fireEvent.change(input, { target: { value: 'old@example.test' } }); await selectType(form, 'Teléfono');
    expect(input).toHaveValue(''); expect(input).toHaveAttribute('placeholder', '+52 449 123 4567');
  });

  it('prevents duplicate submissions while the POST is pending', async () => {
    let resolve!: (value: typeof created) => void; addMock.mockReturnValue(new Promise((done) => { resolve = done; })); const { form } = renderForm(); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: created.value } }); const submit = within(form).getByRole('button', { name: 'Agregar' }); fireEvent.click(submit); fireEvent.submit(form);
    expect(addMock).toHaveBeenCalledTimes(1); expect(submit).toBeDisabled(); resolve(created);
  });

  it('keeps the value and inline form open for duplicate and generic failures', async () => {
    addMock.mockRejectedValueOnce(new ContactApiError(409, 'CONTACT_METHOD_DUPLICATE', 'request-duplicate')); const { form } = renderForm(); const input = within(form).getByRole('textbox', { name: 'Valor' }); fireEvent.change(input, { target: { value: created.value } }); fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    expect(await within(form).findByText('Este medio ya existe para este contacto.')).toBeInTheDocument(); expect(input).toHaveValue(created.value); expect(screen.getByRole('form', { name: 'Agregar medio para María López' })).toBeInTheDocument();
    addMock.mockRejectedValueOnce(new Error('backend internals')); fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    expect(await within(form).findByText('No fue posible agregar el medio de contacto. Inténtalo nuevamente.')).toBeInTheDocument(); expect(input).toHaveValue(created.value); expect(screen.queryByText('backend internals')).not.toBeInTheDocument();
  });
});

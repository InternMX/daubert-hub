import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactApiError } from '../services/contacts';
import { editContactMethod } from '../services/contactMethods';
import { EditContactMethodForm, type EditableDirectoryContactMethod } from './EditContactMethodForm';

vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), editContactMethod: vi.fn() }));
const editMock = vi.mocked(editContactMethod);
const emailMethod: EditableDirectoryContactMethod = { id: '9007199254740993', type: 'CORREO', value: 'typo@example.test', isPrimary: true };
function renderForm(method = emailMethod, onClose = vi.fn(), onEdited = vi.fn()) { render(<EditContactMethodForm method={method} onClose={onClose} onEdited={onEdited} />); return { form: screen.getByRole('form', { name: `Editar medio ${method.value}` }), onClose, onEdited }; }
async function selectType(form: HTMLElement, label: string) { fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo' })); fireEvent.click(await screen.findByRole('option', { name: label })); }

afterEach(() => vi.clearAllMocks());

describe('EditContactMethodForm', () => {
  it('preloads persisted values, offers supported types without OTRO, and starts unchanged', async () => {
    const { form } = renderForm();
    expect(within(form).getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Correo');
    expect(within(form).getByRole('textbox', { name: 'Valor' })).toHaveValue(emailMethod.value);
    expect(within(form).getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo' }));
    expect(await screen.findByRole('option', { name: 'Correo' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Teléfono' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'WhatsApp' })).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Portal / página web' })).toBeInTheDocument(); expect(screen.queryByRole('option', { name: /Otro/i })).not.toBeInTheDocument();
  });

  it('preloads and preserves an existing WEB URL while editing', async () => {
    const method = { ...emailMethod, type: 'WEB' as const, value: 'https://portal.example.test/login?company=31' }; editMock.mockResolvedValue({ id: method.id, type: 'WEB', value: `${method.value}#access`, status: 'ACTIVO' }); const { form } = renderForm(method);
    expect(within(form).getByRole('combobox', { name: 'Tipo' })).toHaveTextContent('Portal / página web'); const input = within(form).getByRole('textbox', { name: 'URL' }); expect(input).toHaveValue(method.value); fireEvent.change(input, { target: { value: `${method.value}#access` } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(method.id, { value: `${method.value}#access` }));
  });

  it.each([
    [{ ...emailMethod }, 'bad-email', 'Ingresa un correo válido.'],
    [{ ...emailMethod, type: 'TELEFONO' as const, value: '+52 449 555 0101' }, 'call me', 'Ingresa un número de contacto válido.'],
    [{ ...emailMethod, type: 'WHATSAPP' as const, value: '+52 449 555 0101' }, 'whatsapp me', 'Ingresa un número de contacto válido.']
  ])('validates the final value for $#.type', async (method, value, message) => {
    const { form } = renderForm(method); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(form).findByText(message)).toBeInTheDocument(); expect(editMock).not.toHaveBeenCalled();
  });

  it('retains a compatible value during TELEFONO/WHATSAPP type changes and sends only type', async () => {
    const method = { ...emailMethod, type: 'WHATSAPP' as const, value: '+52 449 123 4567' }; editMock.mockResolvedValue({ id: method.id, type: 'TELEFONO', value: method.value, status: 'ACTIVO' }); const { form } = renderForm(method);
    await selectType(form, 'Teléfono'); expect(within(form).getByRole('textbox', { name: 'Valor' })).toHaveValue(method.value); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(method.id, { type: 'TELEFONO' }));
  });

  it('rejects an invalid resulting pair after a type change', async () => {
    const { form } = renderForm(); await selectType(form, 'Teléfono'); expect(within(form).getByRole('textbox', { name: 'Valor' })).toHaveValue(emailMethod.value); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(form).findByText('Ingresa un número de contacto válido.')).toBeInTheDocument(); expect(editMock).not.toHaveBeenCalled();
  });

  it.each([
    ['value only', emailMethod, null, ' corrected@example.test ', { value: 'corrected@example.test' }],
    ['type and value', emailMethod, 'WhatsApp', ' +52 449 555 0200 ', { type: 'WHATSAPP', value: '+52 449 555 0200' }]
  ] as const)('sends %s without immutable or payment fields', async (_label, method, nextType, value, expected) => {
    editMock.mockResolvedValue({ id: method.id, type: 'type' in expected ? expected.type : method.type, value: expected.value, status: 'ACTIVO' }); const { form } = renderForm(method); if (nextType) await selectType(form, nextType); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editMock).toHaveBeenCalledWith(method.id, expected)); const payload = editMock.mock.calls[0]![1]; expect(payload).not.toHaveProperty('contactId'); expect(payload).not.toHaveProperty('status'); expect(payload).not.toHaveProperty('isPrimary'); expect(JSON.stringify(payload)).not.toMatch(/payment|pago|observ/);
  });

  it('treats trim-only changes as unchanged and cancel sends no PATCH', () => {
    const { form, onClose } = renderForm(); fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: `  ${emailMethod.value}  ` } }); expect(within(form).getByRole('button', { name: 'Guardar' })).toBeDisabled(); fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' })); expect(onClose).toHaveBeenCalledOnce(); expect(editMock).not.toHaveBeenCalled();
  });

  it.each([
    [new ContactApiError(409, 'CONTACT_METHOD_DUPLICATE', 'request-duplicate'), 'Este medio ya existe para este contacto.'],
    [new Error('backend internals'), 'No fue posible actualizar el medio de contacto. Inténtalo nuevamente.']
  ])('keeps input and form open after a safe failure', async (failure, message) => {
    editMock.mockRejectedValue(failure); const { form, onClose } = renderForm(); const input = within(form).getByRole('textbox', { name: 'Valor' }); fireEvent.change(input, { target: { value: 'corrected@example.test' } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(await within(form).findByText(message)).toBeInTheDocument(); expect(input).toHaveValue('corrected@example.test'); expect(onClose).not.toHaveBeenCalled(); expect(screen.queryByText('backend internals')).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryContact } from '../services/contactDirectory';
import { ContactApiError, updateContact } from '../services/contacts';
import { ContactEditDrawer } from './ContactEditDrawer';

vi.mock('../services/contacts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contacts')>()), updateContact: vi.fn() }));
const updateMock = vi.mocked(updateContact);
const company = { id: '31', commercialName: 'ALMEX' };
const person: DirectoryContact = { id: '9007199254740993', contactType: 'PERSONA', name: 'María López', area: 'Compras', position: 'Compradora', notes: 'Nota inicial', isPrimary: false, methods: [], inactiveMethods: [] };
const updated = { id: person.id, companyId: company.id, contactType: 'PERSONA' as const, name: person.name, area: person.area, position: person.position, notes: person.notes, status: 'ACTIVO', isPrimary: false };
function drawer(contact: DirectoryContact = person, onUpdated = vi.fn()) { render(<ContactEditDrawer company={company} contact={contact} onClose={vi.fn()} onUpdated={onUpdated} />); return screen.getByRole('dialog').querySelector('form') as HTMLFormElement; }

afterEach(() => vi.clearAllMocks());

describe('ContactEditDrawer', () => {
  it('preloads PERSONA fields and shows company and type as read-only context', () => {
    const form = drawer();
    expect(within(form).getByText('ALMEX')).toBeInTheDocument(); expect(within(form).getByText('Persona')).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Nombre' })).toHaveValue('María López'); expect(within(form).getByRole('textbox', { name: 'Área' })).toHaveValue('Compras'); expect(within(form).getByRole('textbox', { name: 'Cargo' })).toHaveValue('Compradora'); expect(within(form).getByRole('textbox', { name: 'Observaciones' })).toHaveValue('Nota inicial');
    expect(within(form).queryByRole('combobox')).not.toBeInTheDocument(); expect(within(form).queryByText('Correo')).not.toBeInTheDocument(); expect(within(form).queryByText('Agregar medio')).not.toBeInTheDocument(); expect(within(form).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('validates required PERSONA name and does not submit an empty edit', async () => {
    const form = drawer(); fireEvent.change(within(form).getByRole('textbox', { name: 'Nombre' }), { target: { value: '   ' } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    expect(await within(form).findByText('Ingresa el nombre del contacto.')).toBeInTheDocument(); expect(updateMock).not.toHaveBeenCalled();
  });

  it('sends changed fields and null clears without immutable or method data', async () => {
    updateMock.mockResolvedValue({ contact: { ...updated, area: null, position: 'Compradora Sr.' }, requestId: 'request-edit' }); const onUpdated = vi.fn(); const form = drawer(person, onUpdated);
    fireEvent.change(within(form).getByRole('textbox', { name: 'Área' }), { target: { value: ' ' } }); fireEvent.change(within(form).getByRole('textbox', { name: 'Cargo' }), { target: { value: ' Compradora Sr. ' } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(person.id, { area: null, position: 'Compradora Sr.' }));
    const payload = updateMock.mock.calls[0]![1]; expect(payload).not.toHaveProperty('companyId'); expect(payload).not.toHaveProperty('contactType'); expect(payload).not.toHaveProperty('status'); expect(payload).not.toHaveProperty('methods'); expect(JSON.stringify(payload)).not.toMatch(/principal|pago/i); expect(onUpdated).toHaveBeenCalledOnce();
  });

  it('prevents duplicate PATCH requests while pending', async () => {
    let resolve!: (value: never) => void; updateMock.mockReturnValue(new Promise((done) => { resolve = done; })); const form = drawer(); const position = within(form).getByRole('textbox', { name: 'Cargo' }); fireEvent.change(position, { target: { value: 'Compradora Sr.' } }); const save = within(form).getByRole('button', { name: 'Guardar cambios' }); fireEvent.click(save); fireEvent.submit(form); expect(updateMock).toHaveBeenCalledTimes(1); resolve({ contact: updated, requestId: null } as never);
  });

  it.each([
    ['AREA', 'Área o departamento', 'Compras', 'Área o departamento'],
    ['BUZON_GENERICO', 'Buzón genérico', 'Pagos', 'Área']
  ] as const)('renders only area and notes fields for %s', (contactType, typeLabel, area, areaLabel) => {
    const form = drawer({ ...person, contactType, name: null, area, position: null }); expect(within(form).getAllByText(typeLabel).length).toBeGreaterThan(0); expect(within(form).getByRole('textbox', { name: areaLabel })).toHaveValue(area); expect(within(form).getByRole('textbox', { name: 'Observaciones' })).toHaveValue('Nota inicial'); expect(within(form).queryByRole('textbox', { name: 'Nombre' })).not.toBeInTheDocument(); expect(within(form).queryByRole('textbox', { name: 'Cargo' })).not.toBeInTheDocument();
  });

  it('edits AREA area and notes without person fields', async () => {
    const areaContact = { ...person, contactType: 'AREA' as const, name: null, area: 'Compras', position: null }; updateMock.mockResolvedValue({ contact: { ...updated, contactType: 'AREA', name: null, area: 'Compras y Abastecimiento', position: null, notes: 'Nota actualizada' }, requestId: null }); const form = drawer(areaContact);
    fireEvent.change(within(form).getByRole('textbox', { name: 'Área o departamento' }), { target: { value: 'Compras y Abastecimiento' } }); fireEvent.change(within(form).getByRole('textbox', { name: 'Observaciones' }), { target: { value: 'Nota actualizada' } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(person.id, { area: 'Compras y Abastecimiento', notes: 'Nota actualizada' }));
  });

  it('keeps values and the drawer open after a safe generic failure', async () => {
    updateMock.mockRejectedValue(new ContactApiError(500, undefined, 'request-failure')); const form = drawer(); fireEvent.change(within(form).getByRole('textbox', { name: 'Cargo' }), { target: { value: 'Compradora Sr.' } }); fireEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' })); expect(await within(form).findByText('No fue posible actualizar el contacto. Inténtalo nuevamente.')).toBeInTheDocument(); expect(within(form).getByRole('textbox', { name: 'Cargo' })).toHaveValue('Compradora Sr.'); expect(screen.getByText('Editar contacto')).toBeInTheDocument();
  });

  it('cancel closes without PATCH', () => {
    const onClose = vi.fn(); render(<ContactEditDrawer company={company} contact={person} onClose={onClose} onUpdated={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); expect(onClose).toHaveBeenCalledOnce(); expect(updateMock).not.toHaveBeenCalled();
  });
});

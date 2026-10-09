import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuditEvent, listAuditEvents, type AuditEvent, type AuditEventsPage } from '../services/audit';
import { listUsers } from '../services/users';
import { AuditPage } from './AuditPage';

vi.mock('../services/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/audit')>()),
  listAuditEvents: vi.fn(),
  getAuditEvent: vi.fn()
}));
vi.mock('../services/users', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/users')>()), listUsers: vi.fn() }));

const listMock = vi.mocked(listAuditEvents);
const detailMock = vi.mocked(getAuditEvent);
const usersMock = vi.mocked(listUsers);

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: '10', occurredAt: '2026-10-05T15:00:00.000Z',
    actor: { id: '1', email: 'ana@daubertcromwell.com', displayName: 'Ana Admin' },
    origin: 'DAUBERT_HUB', category: { key: 'USERS', label: 'Usuarios' }, action: 'UPDATE',
    entity: { key: 'USER', label: 'Usuario' }, record: { reference: 'user_id=7', label: 'gen@daubertcromwell.com' }, requestId: 'req-1', changedFieldCount: 1,
    ...overrides
  };
}

const page = (events: AuditEvent[], meta: Partial<AuditEventsPage['meta']> = {}): AuditEventsPage => ({ data: events, meta: { page: 1, pageSize: 25, total: events.length, totalPages: 1, ...meta } });

function renderPage() {
  return render(<MemoryRouter><AuditPage /></MemoryRouter>);
}

beforeEach(() => {
  usersMock.mockResolvedValue([{ id: '1', displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: '', updatedAt: '', lastLoginAt: null }]);
});
afterEach(() => vi.clearAllMocks());

describe('AuditPage', () => {
  it('lists events with user, module, action, entity and record', async () => {
    listMock.mockResolvedValue(page([makeEvent(), makeEvent({ id: '11', actor: null, origin: 'SISTEMA', action: 'CREATE', category: { key: 'COMPANIES', label: 'Empresas' }, entity: { key: 'COMPANY', label: 'Empresa' }, record: { reference: 'empresa_id=3', label: 'Acme' } })]));
    renderPage();

    const table = await screen.findByRole('table', { name: 'Eventos de auditoría' });
    expect(within(table).getByText('Ana Admin (ana@daubertcromwell.com)')).toBeInTheDocument();
    expect(within(table).getByText('Actualización')).toBeInTheDocument();
    expect(within(table).getByText('Creación')).toBeInTheDocument();
    expect(within(table).getByText('Sistema')).toBeInTheDocument();
    expect(within(table).getByText('Acme')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Auditoría' })).toBeInTheDocument();
  });

  it('shows an empty state, distinguishing "no events" from "no events with these filters"', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText('Aún no hay eventos de auditoría.')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Acción' }));
    await user.click(await screen.findByRole('option', { name: 'Eliminación' }));
    expect(await screen.findByText('No hay eventos con estos filtros.')).toBeInTheDocument();
  });

  it('shows a retryable error', async () => {
    const user = userEvent.setup();
    listMock.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(page([makeEvent()]));
    renderPage();

    expect(await screen.findByText('No fue posible cargar la auditoría. Intenta nuevamente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('table', { name: 'Eventos de auditoría' })).toBeInTheDocument();
  });

  it('applies action, entity and user filters and resets to page 1', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([makeEvent()], { total: 60, totalPages: 3 }));
    renderPage();
    await screen.findByRole('table', { name: 'Eventos de auditoría' });

    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await user.click(screen.getByRole('combobox', { name: 'Acción' }));
    await user.click(await screen.findByRole('option', { name: 'Actualización' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, action: 'UPDATE' })));

    await user.click(screen.getByRole('combobox', { name: 'Entidad' }));
    await user.click(await screen.findByRole('option', { name: 'Usuario' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ entity: 'USER', action: 'UPDATE' })));

    await user.click(screen.getByRole('combobox', { name: 'Usuario' }));
    await user.click(await screen.findByRole('option', { name: 'Ana Admin' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ userId: '1' })));

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, from: undefined, to: undefined, userId: undefined, entity: undefined, action: undefined }));
  });

  it('groups the Entidad filter by module with non-selectable headings and unchanged API keys', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([makeEvent()]));
    renderPage();
    await screen.findByRole('table', { name: 'Eventos de auditoría' });

    await user.click(screen.getByRole('combobox', { name: 'Entidad' }));
    const listbox = await screen.findByRole('listbox');

    // MUI exposes ListSubheader with role=option but no data-value; only entities (plus "Todas") carry a value.
    const options = within(listbox).getAllByRole('option');
    expect(options.filter((option) => option.hasAttribute('data-value')).map((option) => option.textContent)).toEqual([
      'Todas', 'Empresa', 'Rol de empresa', 'Datos fiscales', 'Alias de empresa', 'Dirección', 'Contacto', 'Medio de contacto', 'Usuario', 'Disparo manual', 'Acuse de revisión'
    ]);
    const headings = options.filter((option) => !option.hasAttribute('data-value'));
    expect(headings.map((heading) => heading.textContent)).toEqual(['Empresas', 'Contactos', 'Usuarios', 'Automatizaciones']);

    // Clicking a module heading selects nothing and sends no new request.
    const callsBefore = listMock.mock.calls.length;
    await user.click(headings[0]!);
    expect(listMock.mock.calls.length).toBe(callsBefore);

    // Selected values are still the API entity keys.
    const expected: Array<[string, string]> = [['Disparo manual', 'AUTOMATION_TRIGGER_REQUEST'], ['Acuse de revisión', 'AUTOMATION_REVIEW_ACK'], ['Alias de empresa', 'COMPANY_ALIAS'], ['Medio de contacto', 'CONTACT_METHOD']];
    for (const [label, key] of expected) {
      await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: label }));
      await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ entity: key })));
      await user.click(screen.getByRole('combobox', { name: 'Entidad' }));
    }
  });

  it('sends date filters as Mexico City day boundaries and blocks an inverted range', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([makeEvent()]));
    renderPage();
    await screen.findByRole('table', { name: 'Eventos de auditoría' });

    await user.type(screen.getByLabelText('Desde'), '2026-10-01');
    await user.type(screen.getByLabelText('Hasta'), '2026-10-03');
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01T06:00:00.000Z', to: '2026-10-04T06:00:00.000Z' })));

    const callsBefore = listMock.mock.calls.length;
    await user.clear(screen.getByLabelText('Hasta'));
    await user.type(screen.getByLabelText('Hasta'), '2026-09-01');
    expect(await screen.findByText('La fecha inicial debe ser anterior o igual a la fecha final.')).toBeInTheDocument();
    expect(listMock.mock.calls.slice(callsBefore).every(([query]) => query.to !== '2026-09-02T06:00:00.000Z')).toBe(true);
  });

  it('paginates with Anterior / Siguiente and a range summary', async () => {
    const user = userEvent.setup();
    listMock.mockImplementation(async (query) => page([makeEvent()], { page: query.page, total: 60, totalPages: 3 }));
    renderPage();

    expect(await screen.findByText('1–25 de 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('26–50 de 60')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByText('51–60 de 60')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it('opens the detail panel showing campo / antes / después, never raw JSON', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([makeEvent()]));
    detailMock.mockResolvedValue({
      ...makeEvent(),
      changes: [{ field: 'role', label: 'Rol', before: 'GENERAL', after: 'ADMIN' }, { field: 'password_changed', label: 'Contraseña modificada', before: null, after: 'Sí' }]
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Ver detalle del evento 10' }));

    const changes = await screen.findByRole('table', { name: 'Cambios del evento' });
    expect(detailMock).toHaveBeenCalledWith('10');
    expect(within(changes).getByRole('columnheader', { name: 'Campo' })).toBeInTheDocument();
    expect(within(changes).getByRole('columnheader', { name: 'Antes' })).toBeInTheDocument();
    expect(within(changes).getByRole('columnheader', { name: 'Después' })).toBeInTheDocument();
    expect(within(changes).getByText('GENERAL')).toBeInTheDocument();
    expect(within(changes).getByText('ADMIN')).toBeInTheDocument();
    expect(within(changes).getByText('Contraseña modificada')).toBeInTheDocument();
    expect(screen.getByText('req-1')).toBeInTheDocument();
    expect(screen.getByText('Daubert Hub')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/password_hash|datos_anteriores|datos_nuevos|\{"/);
  });

  it('shows an error inside the detail panel when the event cannot be loaded', async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue(page([makeEvent()]));
    detailMock.mockRejectedValue(new Error('x'));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Ver detalle del evento 10' }));
    expect(await screen.findByText('No fue posible cargar el detalle del evento.')).toBeInTheDocument();
  });
});

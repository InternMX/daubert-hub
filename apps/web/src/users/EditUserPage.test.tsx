import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestAuthProvider, testAdminUser } from '../test/authTestUtils';
import { getUser, updateUser } from '../services/users';
import { EditUserPage } from './EditUserPage';

vi.mock('../services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/users')>()),
  getUser: vi.fn(),
  updateUser: vi.fn()
}));

const getUserMock = vi.mocked(getUser);
const updateUserMock = vi.mocked(updateUser);

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; }

function renderPage(userId: string, authValue?: Parameters<typeof TestAuthProvider>[0]['value']) {
  return render(
    <MemoryRouter initialEntries={[`/users/${userId}/edit`]}>
      <TestAuthProvider value={authValue}>
        <Routes>
          <Route path="/users/:userId/edit" element={<EditUserPage />} />
          <Route path="/users/:userId" element={<div>User detail route</div>} />
        </Routes>
        <Location />
      </TestAuthProvider>
    </MemoryRouter>
  );
}

const otherUser = {
  id: '2', displayName: 'Gen User', email: 'gen@daubertcromwell.com', role: 'GENERAL' as const, status: 'ACTIVE' as const,
  mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null
};

afterEach(() => vi.clearAllMocks());

describe('EditUserPage', () => {
  it('edits displayName', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue(otherUser);
    updateUserMock.mockResolvedValue({ ...otherUser, displayName: 'New Name' });
    renderPage('2');

    const nameField = await screen.findByLabelText('Nombre');
    await user.clear(nameField);
    await user.type(nameField, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith('2', { displayName: 'New Name', email: otherUser.email, role: 'GENERAL' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/users/2');
  });

  it('edits email', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue(otherUser);
    updateUserMock.mockResolvedValue({ ...otherUser, email: 'new@daubertcromwell.com' });
    renderPage('2');

    const emailField = await screen.findByLabelText('Correo');
    await user.clear(emailField);
    await user.type(emailField, 'new@daubertcromwell.com');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith('2', expect.objectContaining({ email: 'new@daubertcromwell.com' })));
  });

  it('edits role', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue(otherUser);
    updateUserMock.mockResolvedValue({ ...otherUser, role: 'ADMIN' });
    renderPage('2');

    await screen.findByLabelText('Nombre');
    await user.click(screen.getByLabelText('Rol'));
    await user.click(await screen.findByRole('option', { name: 'Administrador' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith('2', expect.objectContaining({ role: 'ADMIN' })));
  });

  it('disables the role field when the ADMIN edits their own account, and never sends role in that case', async () => {
    const user = userEvent.setup();
    const self = { ...otherUser, id: testAdminUser.id, displayName: testAdminUser.displayName, email: testAdminUser.email, role: 'ADMIN' as const };
    getUserMock.mockResolvedValue(self);
    updateUserMock.mockResolvedValue({ ...self, displayName: 'Renamed Self' });
    renderPage(testAdminUser.id);

    const nameField = await screen.findByLabelText('Nombre');
    expect(screen.getByLabelText('Rol')).toHaveAttribute('aria-disabled', 'true');
    await user.clear(nameField);
    await user.type(nameField, 'Renamed Self');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith(testAdminUser.id, { displayName: 'Renamed Self', email: testAdminUser.email }));
  });
});

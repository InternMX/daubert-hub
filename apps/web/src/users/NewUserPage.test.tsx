import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../services/users';
import { NewUserPage } from './NewUserPage';

vi.mock('../services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/users')>()),
  createUser: vi.fn()
}));

const createUserMock = vi.mocked(createUser);

function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/users/new']}>
      <Routes>
        <Route path="/users/new" element={<NewUserPage />} />
        <Route path="/users/:userId" element={<div>User detail route</div>} />
      </Routes>
      <Location />
    </MemoryRouter>
  );
}

const managedUser = {
  id: '1', displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN' as const, status: 'ACTIVE' as const,
  mustChangePassword: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null
};

afterEach(() => vi.clearAllMocks());

describe('NewUserPage', () => {
  it('rejects a temporary password shorter than 12 characters', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Ana Admin');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'short');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'short');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText(/al menos 12 caracteres/i)).toBeInTheDocument();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Ana Admin');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('does not trim the temporary password', async () => {
    const user = userEvent.setup();
    createUserMock.mockResolvedValue(managedUser);
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Ana Admin');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), '  spaced password  ');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), '  spaced password  ');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ temporaryPassword: '  spaced password  ' })));
  });

  it('creates an ADMIN user and redirects to the new user detail', async () => {
    const user = userEvent.setup();
    createUserMock.mockResolvedValue(managedUser);
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Ana Admin');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@daubertcromwell.com');
    await user.click(screen.getByLabelText('Rol'));
    await user.click(await screen.findByRole('option', { name: 'Administrador' }));
    await user.type(screen.getByLabelText('Contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(createUserMock).toHaveBeenCalledWith({ displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN', temporaryPassword: 'a-valid-temp-password' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/users/1');
  });

  it('creates a GENERAL user (the default role)', async () => {
    const user = userEvent.setup();
    createUserMock.mockResolvedValue({ ...managedUser, role: 'GENERAL' });
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Gen User');
    await user.type(screen.getByLabelText('Correo electrónico'), 'gen@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ role: 'GENERAL' })));
  });

  it('shows a duplicate-email error on the email field', async () => {
    const user = userEvent.setup();
    const { UsersApiError } = await import('../services/users');
    createUserMock.mockRejectedValue(new UsersApiError(409, 'USER_EMAIL_CONFLICT', 'Ya existe un usuario registrado con ese correo electrónico.'));
    renderPage();
    await user.type(screen.getByLabelText('Nombre'), 'Ana Admin');
    await user.type(screen.getByLabelText('Correo electrónico'), 'ana@daubertcromwell.com');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));

    expect(await screen.findByText('Ya existe un usuario registrado con ese correo electrónico.')).toBeInTheDocument();
  });

  it('explains the mandatory first-login password change', () => {
    renderPage();
    expect(screen.getByText('El usuario deberá cambiar esta contraseña en su primer inicio de sesión.')).toBeInTheDocument();
  });
});

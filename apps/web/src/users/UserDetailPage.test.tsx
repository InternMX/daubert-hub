import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestAuthProvider, testAdminUser } from '../test/authTestUtils';
import { deactivateUser, getUser, reactivateUser } from '../services/users';
import { UserDetailPage } from './UserDetailPage';

vi.mock('../services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/users')>()),
  getUser: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn()
}));

const getUserMock = vi.mocked(getUser);
const deactivateUserMock = vi.mocked(deactivateUser);
const reactivateUserMock = vi.mocked(reactivateUser);

const otherActiveUser = {
  id: '2',
  displayName: 'Gen User',
  email: 'gen@daubertcromwell.com',
  role: 'GENERAL' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  lastLoginAt: null
};

const selfUser = {
  id: testAdminUser.id,
  displayName: testAdminUser.displayName,
  email: testAdminUser.email,
  role: 'ADMIN' as const,
  status: 'ACTIVE' as const,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-09-06T15:30:00.000Z'
};

function renderPage(userId: string) {
  return render(
    <MemoryRouter initialEntries={[`/users/${userId}`]}>
      <TestAuthProvider>
        <Routes><Route path="/users/:userId" element={<UserDetailPage />} /></Routes>
      </TestAuthProvider>
    </MemoryRouter>
  );
}

afterEach(() => vi.clearAllMocks());

describe('UserDetailPage', () => {
  it('renders only safe fields — no password/session material anywhere on the page', async () => {
    getUserMock.mockResolvedValue(otherActiveUser);
    renderPage('2');

    expect(await screen.findByRole('heading', { level: 1, name: 'Gen User' })).toBeInTheDocument();
    expect(screen.getByText('gen@daubertcromwell.com')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Nunca')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/passwordHash|password_hash|tokenHash|token_hash|argon2/i);
  });

  it('disables self-deactivate and self-reset-password for the authenticated ADMIN viewing their own account', async () => {
    getUserMock.mockResolvedValue(selfUser);
    renderPage(testAdminUser.id);

    await screen.findByRole('heading', { level: 1, name: testAdminUser.displayName });
    expect(screen.getByRole('button', { name: 'Desactivar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Restablecer contraseña' })).toBeDisabled();
  });

  it('allows deactivating another ACTIVE user after confirming', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue(otherActiveUser);
    deactivateUserMock.mockResolvedValue({ ...otherActiveUser, status: 'INACTIVE' });
    renderPage('2');

    await screen.findByRole('heading', { level: 1, name: 'Gen User' });
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    expect(await screen.findByText('El usuario perderá acceso inmediatamente y se cerrarán sus sesiones activas.')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));

    await waitFor(() => expect(deactivateUserMock).toHaveBeenCalledWith('2'));
    expect(await screen.findByText('Inactivo')).toBeInTheDocument();
  });

  it('reactivates an INACTIVE user', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue({ ...otherActiveUser, status: 'INACTIVE' });
    reactivateUserMock.mockResolvedValue({ ...otherActiveUser, status: 'ACTIVE' });
    renderPage('2');

    await screen.findByRole('heading', { level: 1, name: 'Gen User' });
    await user.click(screen.getByRole('button', { name: 'Reactivar' }));
    expect(await screen.findByText('Reactivar no inicia una sesión automáticamente.', { exact: false })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => expect(reactivateUserMock).toHaveBeenCalledWith('2'));
    expect(await screen.findByText('Activo')).toBeInTheDocument();
  });

  it('shows a clear message when the backend rejects the last active admin from being deactivated', async () => {
    const user = userEvent.setup();
    getUserMock.mockResolvedValue(otherActiveUser);
    const { UsersApiError } = await import('../services/users');
    deactivateUserMock.mockRejectedValue(new UsersApiError(409, 'LAST_ACTIVE_ADMIN', 'No es posible completar esta acción: debe existir al menos un administrador activo.'));
    renderPage('2');

    await screen.findByRole('heading', { level: 1, name: 'Gen User' });
    await user.click(screen.getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }));

    expect(await screen.findByText('No es posible completar esta acción: debe existir al menos un administrador activo.')).toBeInTheDocument();
  });
});

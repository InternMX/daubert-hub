import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listUsers } from '../services/users';
import { UsersPage } from './UsersPage';

vi.mock('../services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/users')>()),
  listUsers: vi.fn()
}));

const listUsersMock = vi.mocked(listUsers);

function renderPage() {
  return render(<MemoryRouter initialEntries={['/users']}><Routes><Route path="/users" element={<UsersPage />} /></Routes></MemoryRouter>);
}

afterEach(() => vi.clearAllMocks());

describe('UsersPage', () => {
  it('renders users with Spanish role/status labels and Nunca for a null last login', async () => {
    listUsersMock.mockResolvedValue([
      { id: '1', displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-09-06T15:30:00.000Z' },
      { id: '2', displayName: 'Gen User', email: 'gen@daubertcromwell.com', role: 'GENERAL', status: 'INACTIVE', mustChangePassword: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null }
    ]);

    renderPage();

    expect(await screen.findByText('Ana Admin')).toBeInTheDocument();
    expect(screen.getByText('Gen User')).toBeInTheDocument();
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    expect(screen.getByText('Nunca')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo usuario' })).toHaveAttribute('href', '/users/new');
    expect(screen.getByRole('link', { name: 'Ana Admin' })).toHaveAttribute('href', '/users/1');
  });

  it('renders the ADMIN role as a filled primary Chip (yellow background + dark contrastText) rather than outlined yellow-on-white', async () => {
    listUsersMock.mockResolvedValue([
      { id: '1', displayName: 'Ana Admin', email: 'ana@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null },
      { id: '2', displayName: 'Gen User', email: 'gen@daubertcromwell.com', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null }
    ]);

    renderPage();

    const adminChip = (await screen.findByText('Administrador')).closest('.MuiChip-root');
    expect(adminChip).toHaveClass('MuiChip-filledPrimary');
    expect(adminChip).not.toHaveClass('MuiChip-outlined');

    const generalChip = screen.getByText('General').closest('.MuiChip-root');
    expect(generalChip).toHaveClass('MuiChip-outlined');
    expect(generalChip).not.toHaveClass('MuiChip-filledPrimary');
  });

  it('shows an empty state with zero users', async () => {
    listUsersMock.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Aún no hay usuarios registrados.')).toBeInTheDocument();
  });

  it('shows a retryable error when the list fails to load', async () => {
    listUsersMock.mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText('No fue posible cargar los usuarios. Intenta nuevamente.')).toBeInTheDocument();
  });
});

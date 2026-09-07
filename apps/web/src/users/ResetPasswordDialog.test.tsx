import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetPassword, UsersApiError } from '../services/users';
import { ResetPasswordDialog } from './ResetPasswordDialog';

vi.mock('../services/users', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/users')>()),
  resetPassword: vi.fn()
}));

const resetPasswordMock = vi.mocked(resetPassword);

const managedUser = {
  id: '2', displayName: 'Gen User', email: 'gen@daubertcromwell.com', role: 'GENERAL' as const, status: 'ACTIVE' as const,
  mustChangePassword: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null
};

afterEach(() => vi.clearAllMocks());

describe('ResetPasswordDialog', () => {
  it('explains the consequence before submitting', () => {
    render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText('Las sesiones activas del usuario se cerrarán y deberá cambiar esta contraseña al volver a iniciar sesión.')).toBeInTheDocument();
  });

  it('rejects a password shorter than 12 characters', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText('Nueva contraseña temporal'), 'short');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'short');
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByText(/al menos 12 caracteres/i)).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText('Nueva contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('succeeds and reports mustChangePassword=true to the caller', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    resetPasswordMock.mockResolvedValue(managedUser);
    render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText('Nueva contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ mustChangePassword: true })));
    expect(resetPasswordMock).toHaveBeenCalledWith('2', 'a-valid-temp-password');
  });

  it('shows a backend error, e.g. self-reset rejection', async () => {
    const user = userEvent.setup();
    resetPasswordMock.mockRejectedValue(new UsersApiError(409, 'SELF_PASSWORD_RESET_NOT_ALLOWED', 'No puedes restablecer tu propia contraseña desde este flujo. Usa el cambio de contraseña de tu cuenta.'));
    render(<ResetPasswordDialog open userId="1" onClose={vi.fn()} onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText('Nueva contraseña temporal'), 'a-valid-temp-password');
    await user.type(screen.getByLabelText('Confirmar contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

    expect(await screen.findByText('No puedes restablecer tu propia contraseña desde este flujo. Usa el cambio de contraseña de tu cuenta.')).toBeInTheDocument();
  });

  it('clears password fields after closing (Cancel), so they never persist across reopens', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<ResetPasswordDialog open userId="2" onClose={onClose} onSuccess={vi.fn()} />);
    await user.type(screen.getByLabelText('Nueva contraseña temporal'), 'a-valid-temp-password');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();

    rerender(<ResetPasswordDialog open={false} userId="2" onClose={onClose} onSuccess={vi.fn()} />);
    rerender(<ResetPasswordDialog open userId="2" onClose={onClose} onSuccess={vi.fn()} />);
    expect(screen.getByLabelText('Nueva contraseña temporal')).toHaveValue('');
  });

  it('generating a password populates both fields, satisfies the policy, and can be submitted', async () => {
    const user = userEvent.setup();
    resetPasswordMock.mockResolvedValue(managedUser);
    render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Generar contraseña' }));

    const passwordField = screen.getByLabelText('Nueva contraseña temporal') as HTMLInputElement;
    const confirmField = screen.getByLabelText('Confirmar contraseña temporal') as HTMLInputElement;
    expect(passwordField.value).toHaveLength(16);
    expect(confirmField.value).toBe(passwordField.value);
    expect(passwordField.value.length).toBeGreaterThanOrEqual(12);
    // Captured now: submitting clears the field on success (below), and the
    // input's .value is a live DOM read, not a snapshot.
    const generatedPassword = passwordField.value;

    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));

    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalledWith('2', generatedPassword));
  });

  it('clears the generated password from state after a successful reset', async () => {
    const user = userEvent.setup();
    resetPasswordMock.mockResolvedValue(managedUser);
    const { rerender } = render(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Generar contraseña' }));
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalled());

    rerender(<ResetPasswordDialog open={false} userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);
    rerender(<ResetPasswordDialog open userId="2" onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByLabelText('Nueva contraseña temporal')).toHaveValue('');
    expect(screen.getByLabelText('Confirmar contraseña temporal')).toHaveValue('');
  });
});

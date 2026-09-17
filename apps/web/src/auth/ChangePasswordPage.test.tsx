import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChangePasswordPage } from './ChangePasswordPage';
import { AuthContext, type AuthContextValue } from './authContext.core';

function renderChangePassword(overrides: Partial<AuthContextValue> = {}) {
  const authValue: AuthContextValue = {
    user: { id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: true },
    isLoading: false,
    hydrationFailed: false,
    login: async () => { throw new Error('not used in this test'); },
    logout: async () => undefined,
    refreshUser: async () => null,
    changePassword: async () => { throw new Error('not used in this test'); },
    ...overrides
  };
  return render(
    <AuthContext.Provider value={authValue}>
      <ChangePasswordPage />
    </AuthContext.Provider>
  );
}

// Password visibility UX fix: this page has three independent password
// fields (current, new, confirm). Each must carry its own persistent
// show/hide control that survives blur and never leaks into the others.
describe('ChangePasswordPage password visibility toggles', () => {
  it('offers an independent, always-available toggle for each of the three password fields', async () => {
    const user = userEvent.setup();
    renderChangePassword();
    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'a-new-long-password');
    expect(screen.getAllByRole('button', { name: 'Mostrar contraseña' })).toHaveLength(3);
  });

  it('remains available after a field is blurred', async () => {
    const user = userEvent.setup();
    renderChangePassword();
    const currentField = screen.getByLabelText('Contraseña actual');
    await user.type(currentField, 'current-password');
    currentField.blur();
    expect(screen.getAllByRole('button', { name: 'Mostrar contraseña' })[0]).toBeInTheDocument();
  });

  it('remains available on the first field once focus moves to a different password field', async () => {
    const user = userEvent.setup();
    renderChangePassword();
    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.click(screen.getByLabelText('Nueva contraseña'));
    expect(screen.getByLabelText('Nueva contraseña')).toHaveFocus();
    expect(screen.getAllByRole('button', { name: 'Mostrar contraseña' })).toHaveLength(3);
  });

  it('toggles each field independently — revealing one never reveals the others', async () => {
    const user = userEvent.setup();
    renderChangePassword();
    const currentField = screen.getByLabelText('Contraseña actual') as HTMLInputElement;
    const newField = screen.getByLabelText('Nueva contraseña') as HTMLInputElement;
    const confirmField = screen.getByLabelText('Confirmar nueva contraseña') as HTMLInputElement;
    await user.type(currentField, 'current-password');
    await user.type(newField, 'a-new-long-password');
    await user.type(confirmField, 'a-new-long-password');

    const [currentToggle] = screen.getAllByRole('button', { name: 'Mostrar contraseña' });
    await user.click(currentToggle!);

    expect(currentField).toHaveAttribute('type', 'text');
    expect(newField).toHaveAttribute('type', 'password');
    expect(confirmField).toHaveAttribute('type', 'password');
    // Values untouched by toggling.
    expect(currentField.value).toBe('current-password');
    expect(newField.value).toBe('a-new-long-password');
    expect(confirmField.value).toBe('a-new-long-password');
  });

  it('is reachable and activatable by keyboard for each field', async () => {
    const user = userEvent.setup();
    renderChangePassword();
    const newField = screen.getByLabelText('Nueva contraseña') as HTMLInputElement;
    await user.type(newField, 'a-new-long-password');
    newField.focus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(newField).toHaveAttribute('type', 'text');
  });

  it('does not interfere with existing validation/submit behavior', async () => {
    const user = userEvent.setup();
    renderChangePassword();

    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'short');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'different');
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(screen.getByText(/al menos 12 caracteres/i)).toBeInTheDocument();
    expect(screen.getByText('Las contraseñas no coinciden.')).toBeInTheDocument();
  });

  it('submits the exact typed values regardless of visibility state', async () => {
    const user = userEvent.setup();
    const changePassword = vi.fn().mockResolvedValue({ id: '1', displayName: 'Alejandro López', email: 'alejandro@daubertcromwell.com', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false });
    renderChangePassword({ changePassword });

    await user.type(screen.getByLabelText('Contraseña actual'), 'current-password');
    await user.type(screen.getByLabelText('Nueva contraseña'), 'a-new-long-password');
    await user.type(screen.getByLabelText('Confirmar nueva contraseña'), 'a-new-long-password');
    const [, newToggle] = screen.getAllByRole('button', { name: 'Mostrar contraseña' });
    await user.click(newToggle!);
    await user.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));

    expect(changePassword).toHaveBeenCalledWith('current-password', 'a-new-long-password');
  });
});

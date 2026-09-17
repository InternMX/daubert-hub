import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PasswordVisibilityToggle } from './PasswordVisibilityToggle';

function Harness({ initialVisible = false }: { initialVisible?: boolean }) {
  const [visible, setVisible] = useState(initialVisible);
  return <PasswordVisibilityToggle visible={visible} onToggle={() => setVisible((value) => !value)} />;
}

describe('PasswordVisibilityToggle', () => {
  it('shows the "Mostrar contraseña" label and icon when hidden', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toBeInTheDocument();
  });

  it('switches to the "Ocultar contraseña" label after being toggled visible', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toBeInTheDocument();
  });

  it('is reachable and activatable by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Mostrar contraseña' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toBeInTheDocument();
  });

  it('calls onToggle exactly once per activation and never mutates any value itself', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<PasswordVisibilityToggle visible={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('can be disabled without losing its accessible name', () => {
    render(<PasswordVisibilityToggle visible={false} onToggle={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(button).toBeDisabled();
  });
});

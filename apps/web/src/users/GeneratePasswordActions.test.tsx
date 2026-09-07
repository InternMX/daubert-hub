import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratePasswordActions } from './GeneratePasswordActions';

afterEach(() => vi.unstubAllGlobals());

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  return writeText;
}

describe('GeneratePasswordActions', () => {
  it('calls onGenerate with a generated value when Generar contraseña is clicked', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GeneratePasswordActions password="" onGenerate={onGenerate} />);

    await user.click(screen.getByRole('button', { name: 'Generar contraseña' }));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    const [generated] = onGenerate.mock.calls[0] as [string];
    expect(generated).toHaveLength(16);
  });

  it('copies the current password to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<GeneratePasswordActions password="a-generated-password" onGenerate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(writeText).toHaveBeenCalledWith('a-generated-password');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('disables Copiar when there is no password yet', () => {
    render(<GeneratePasswordActions password="" onGenerate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeDisabled();
  });

  it('disables both actions when disabled is passed', () => {
    render(<GeneratePasswordActions password="something" onGenerate={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Generar contraseña' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeDisabled();
  });
});

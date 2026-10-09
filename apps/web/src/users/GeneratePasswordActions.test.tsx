import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneratePasswordActions } from './GeneratePasswordActions';

// document.execCommand is absent in jsdom; capture whatever exists so every
// stub is undone and cannot leak into other tests.
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
  else Reflect.deleteProperty(document, 'execCommand');
});

function stubExecCommand(result: boolean) {
  const execCommand = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
  return execCommand;
}

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

  it('falls back to execCommand when navigator.clipboard is unavailable (insecure context)', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const execCommand = stubExecCommand(true);
    render(<GeneratePasswordActions password="a-generated-password" onGenerate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back to execCommand when the clipboard write is rejected', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const execCommand = stubExecCommand(true);
    render(<GeneratePasswordActions password="a-generated-password" onGenerate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });

  it('shows "No se pudo copiar" when every copy method fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    stubExecCommand(false);
    render(<GeneratePasswordActions password="a-generated-password" onGenerate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Copiar' }));

    expect(await screen.findByRole('button', { name: 'No se pudo copiar' })).toBeInTheDocument();
    expect(document.querySelector('textarea')).toBeNull();
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

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ClientForm } from './ClientForm';

describe('ClientForm', () => {
  it('renders Spanish fields with no provider-type selector', () => {
    render(<ClientForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Nombre comercial/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Razón social')).toBeInTheDocument();
    expect(screen.getByLabelText('RFC')).toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('prevents missing required fields and partial or malformed fiscal data', async () => {
    const user = userEvent.setup();
    render(<ClientForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(screen.getByText('Ingresa el nombre comercial.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Acme');
    await user.type(screen.getByLabelText('Razón social'), 'Acme SA');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(screen.getByText('Para registrar datos fiscales, completa la razón social y el RFC.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('RFC'), 'ABC 123');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(screen.getByText('Ingresa un RFC de 12 o 13 caracteres sin espacios.')).toBeInTheDocument();
  });

  it('submits normalized payload without fiscal data and empty notes as null', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClientForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), '  New Client  ');
    await user.type(screen.getByLabelText('Observaciones'), '   ');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'New Client', fiscal: null, notes: null });
  });

  it('submits fiscal data with uppercase RFC and blocks duplicate submission while pending', async () => {
    const user = userEvent.setup();
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveSubmit = resolve; }));
    render(<ClientForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), '  Novapak ');
    await user.type(screen.getByLabelText('Razón social'), '  Novapak SA ');
    await user.type(screen.getByLabelText('RFC'), 'abc123456xyz');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(screen.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Guardando...' }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'Novapak', fiscal: { legalName: 'Novapak SA', rfc: 'ABC123456XYZ' }, notes: null });
    resolveSubmit();
  });

  it.each([
    ['CLIENT_ALREADY_ACTIVE', 'Ya existe un cliente activo con ese nombre comercial.'],
    ['CLIENT_NAME_CONFLICT', 'Ya existe una empresa con ese nombre comercial.']
  ])('shows the identity conflict %s in Spanish', async (code, message) => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ code });
    render(<ClientForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

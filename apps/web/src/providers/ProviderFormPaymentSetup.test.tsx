import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProviderForm } from './ProviderForm';

async function selectProviderType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
  await user.click(screen.getByRole('option', { name: label }));
}

const later = () => screen.getByRole('radio', { name: 'Configurar después' });
const now = () => screen.getByRole('radio', { name: 'Configurar ahora' });
const LATER_NOTE = 'Puedes configurar las notificaciones de pago más tarde desde la ficha del proveedor.';

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'Novapak');
  await selectProviderType(user, 'Proveedor');
}

describe('ProviderForm — Notificaciones de pago (UI progresiva, solo estado de UI)', () => {
  it('"Configurar después" viene seleccionado por defecto, con la pregunta y el texto aclaratorio siempre visibles', () => {
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Notificaciones de pago' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '¿Deseas configurar las notificaciones de pago ahora?' })).toBeInTheDocument();
    expect(later()).toBeChecked();
    expect(now()).not.toBeChecked();
    expect(screen.getByText(LATER_NOTE)).toBeInTheDocument();
  });

  it('con "Configurar después" no aparecen campos extra y el botón sigue siendo "Guardar proveedor"', () => {
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: 'Ruta de Dropbox' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Procesa comprobantes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Los destinatarios de correo se configuran después de crear el proveedor.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar proveedor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar y continuar' })).not.toBeInTheDocument();
  });

  it('guardar con "Configurar después" conserva el payload previo: un solo argumento y sin rutaDropbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'Novapak', providerType: 'PROVEEDOR', fiscal: null, notes: null });
    expect(onSubmit.mock.calls[0]).toHaveLength(1);
  });

  it('"Configurar ahora" muestra Ruta de Dropbox, Procesa comprobantes, la nota de destinatarios y el CTA "Guardar y continuar"', async () => {
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(now());
    expect(now()).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Ruta de Dropbox' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Procesa comprobantes' })).not.toBeChecked();
    expect(screen.getByText('Los destinatarios de correo se configuran después de crear el proveedor.')).toBeInTheDocument();
    expect(screen.getByText(LATER_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar y continuar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar proveedor' })).not.toBeInTheDocument();
  });

  it('la aclaración de que la configuración no activa las notificaciones solo aparece con "Configurar ahora"', async () => {
    const user = userEvent.setup();
    const NOTE = 'La configuración no activa automáticamente las notificaciones. Podrás activarlas desde la ficha del proveedor cuando todos los requisitos estén completos.';
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    await user.click(now());
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    await user.click(later());
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('volver a "Configurar después" oculta los controles y restituye "Guardar proveedor"', async () => {
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(now());
    await user.click(later());
    expect(later()).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Ruta de Dropbox' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Procesa comprobantes' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar proveedor' })).toBeInTheDocument();
  });

  it('una ruta escrita y luego ocultada con "Configurar después" NO se envía', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillBasics(user);
    await user.click(now());
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), 'PROVEEDORES/NOVAPAK');
    await user.click(later());
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'Novapak', providerType: 'PROVEEDOR', fiscal: null, notes: null });
  });

  it('"Configurar ahora" envía rutaDropbox recortada y el intento de "Procesa comprobantes" como segundo argumento, sin ninguna bandera NOW/LATER en el payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillBasics(user);
    await user.click(now());
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), '  PROVEEDORES/NOVAPAK  ');
    await user.click(screen.getByRole('switch', { name: 'Procesa comprobantes' }));
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'Novapak', providerType: 'PROVEEDOR', fiscal: null, notes: null, rutaDropbox: 'PROVEEDORES/NOVAPAK' }, { processesPaymentReceipts: true });
    expect(Object.keys(onSubmit.mock.calls[0]![0] as object).sort()).toEqual(['commercialName', 'fiscal', 'notes', 'providerType', 'rutaDropbox']);
    expect(JSON.stringify(onSubmit.mock.calls[0]![0])).not.toMatch(/NOW|LATER/);
  });

  it('"Configurar ahora" sin ruta: no envía rutaDropbox y Procesa comprobantes queda en false', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillBasics(user);
    await user.click(now());
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('rutaDropbox');
    expect(onSubmit.mock.calls[0]![1]).toEqual({ processesPaymentReceipts: false });
  });

  it('las validaciones existentes siguen aplicando con "Configurar ahora" y no se llama a onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.click(now());
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(screen.getByText('Ingresa el nombre comercial.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Cancelar sigue funcionando en ambos modos', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(now());
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('un error de ruta de Dropbox del backend se muestra en el campo y conserva la selección "Configurar ahora"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ code: 'DROPBOX_PATH_ABSOLUTE', requestId: 'r' });
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await fillBasics(user);
    await user.click(now());
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), 'X');
    await user.click(screen.getByRole('button', { name: 'Guardar y continuar' }));
    expect(await screen.findByText(/ruta relativa a Dropbox válida/)).toBeInTheDocument();
    expect(now()).toBeChecked();
  });
});

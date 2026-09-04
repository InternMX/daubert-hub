import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompanyAliases, updateCompanyAliases } from '../services/companyAliases';
import { CompanyAliasesSection } from './CompanyAliasesSection';

vi.mock('../services/companyAliases', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/companyAliases')>()), getCompanyAliases: vi.fn(), updateCompanyAliases: vi.fn() }));
const getMock = vi.mocked(getCompanyAliases);
const updateMock = vi.mocked(updateCompanyAliases);

afterEach(() => vi.clearAllMocks());

describe('CompanyAliasesSection', () => {
  it('loads independently and supports retry', async () => {
    getMock.mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce({ aliases: [], otherAliases: [] });
    render(<CompanyAliasesSection companyId="121" />);
    expect(screen.getByLabelText('Cargando alias')).toBeInTheDocument();
    expect(await screen.findByText('No fue posible cargar los alias.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('No hay nombres alternativos registrados.')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledWith('121');
  });

  it('is read-only by default and shows the empty state with no editable aliases', async () => {
    getMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    render(<CompanyAliasesSection companyId="121" />);
    expect(await screen.findByText('No hay nombres alternativos registrados.')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Escribe un alias y presiona Enter...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar alias' })).toBeInTheDocument();
  });

  it('shows existing aliases and read-only otherAliases in the default view', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC', 'DAUBERT USA'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    render(<CompanyAliasesSection companyId="121" />);
    expect(await screen.findByText('BMASC')).toBeInTheDocument();
    expect(screen.getByText('DAUBERT USA')).toBeInTheDocument();
    expect(screen.getByText('ACME FILE · Nombre de archivo')).toBeInTheDocument();
    expect(screen.queryByLabelText('Eliminar alias BMASC')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Escribe un alias y presiona Enter...')).not.toBeInTheDocument();
  });

  it('enters edit mode with Editar alias, reusing CompanyAliasesField', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    expect(screen.getByPlaceholderText('Escribe un alias y presiona Enter...')).toBeInTheDocument();
    expect(screen.getByLabelText('Eliminar alias BMASC')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('Cancelar restores the last server-loaded values and exits edit mode', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'B+ASC{Enter}');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByPlaceholderText('Escribe un alias y presiona Enter...')).not.toBeInTheDocument();
    expect(screen.getByText('BMASC')).toBeInTheDocument();
    expect(screen.queryByText('B+ASC')).not.toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('saves through the generic company aliases API and returns to read-only mode', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    updateMock.mockResolvedValue({ aliases: { aliases: ['BMASC', 'B+ASC'], otherAliases: [] }, requestId: 'request-1' });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'B+ASC{Enter}');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(updateMock).toHaveBeenCalledWith('121', ['BMASC', 'B+ASC']);
    expect(await screen.findByText('B+ASC')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Escribe un alias y presiona Enter...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar alias' })).toBeInTheDocument();
  });

  it('keeps Guardar cambios disabled when nothing changed', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('shows a specific conflict message for a cross-company alias', async () => {
    getMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    updateMock.mockRejectedValue({ code: 'ALIAS_ALREADY_ASSOCIATED' });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByRole('button', { name: 'Editar alias' });
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'TAKEN{Enter}');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Este alias ya está asociado a otra empresa.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('shows a generic error for a non-conflict save failure', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    updateMock.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.click(screen.getByRole('button', { name: 'Editar alias' }));
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'B+ASC{Enter}');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('No fue posible actualizar los alias. Inténtalo nuevamente.')).toBeInTheDocument();
  });

  it('preserves an exact BIGINT-style company id beyond Number.MAX_SAFE_INTEGER', async () => {
    const companyId = '9007199254740993123';
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    render(<CompanyAliasesSection companyId={companyId} />);
    await screen.findByText('BMASC');
    expect(getMock).toHaveBeenCalledWith(companyId);
  });
});

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
    expect(await screen.findByPlaceholderText('Escribe un alias y presiona Enter...')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenCalledWith('121');
  });

  it('renders editable and read-only aliases with a disabled save button until changed', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [{ alias: 'ACME FILE', type: 'NOMBRE_ARCHIVO' }] });
    render(<CompanyAliasesSection companyId="121" />);
    expect(await screen.findByText('BMASC')).toBeInTheDocument();
    expect(screen.getByText('ACME FILE · Nombre de archivo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeDisabled();
  });

  it('saves the edited alias set and shows success feedback', async () => {
    getMock.mockResolvedValue({ aliases: ['BMASC'], otherAliases: [] });
    updateMock.mockResolvedValue({ aliases: { aliases: ['BMASC', 'B+ASC'], otherAliases: [] }, requestId: 'request-1' });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByText('BMASC');
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'B+ASC{Enter}');
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(updateMock).toHaveBeenCalledWith('121', ['BMASC', 'B+ASC']);
    expect(await screen.findByText('Alias actualizados correctamente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar alias' })).toBeDisabled();
  });

  it('shows a specific conflict message for a cross-company alias', async () => {
    getMock.mockResolvedValue({ aliases: [], otherAliases: [] });
    updateMock.mockRejectedValue({ code: 'ALIAS_ALREADY_ASSOCIATED' });
    const user = userEvent.setup();
    render(<CompanyAliasesSection companyId="121" />);
    await screen.findByPlaceholderText('Escribe un alias y presiona Enter...');
    await user.type(screen.getByPlaceholderText('Escribe un alias y presiona Enter...'), 'TAKEN{Enter}');
    await user.click(screen.getByRole('button', { name: 'Guardar alias' }));
    expect(await screen.findByText('Este alias ya está asociado a otra empresa.')).toBeInTheDocument();
  });
});

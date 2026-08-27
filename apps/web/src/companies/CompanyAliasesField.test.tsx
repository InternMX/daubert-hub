import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CompanyAliasesField } from './CompanyAliasesField';
import type { OtherCompanyAliasType } from '../services/providers';

function Field({ initial = [], otherAliases = [] }: { initial?: string[]; otherAliases?: Array<{ alias: string; type: OtherCompanyAliasType }> }) {
  const [aliases, setAliases] = useState(initial);
  return <CompanyAliasesField value={aliases} otherAliases={otherAliases} onChange={setAliases} />;
}

describe('CompanyAliasesField', () => {
  it('adds a trimmed alias and rejects a case-insensitive duplicate', async () => {
    const user = userEvent.setup();
    render(<Field />);
    const input = screen.getByPlaceholderText('Escribe un alias y presiona Enter...');
    await user.type(input, '  Daubert  {Enter}');
    expect(screen.getByText('Daubert')).toBeInTheDocument();
    await user.type(input, 'daubert{Enter}');
    expect(screen.getAllByText('Daubert')).toHaveLength(1);
    expect(screen.getByText('Este alias ya está registrado.')).toBeInTheDocument();
  });

  it('removes a chip only through its delete action', async () => {
    const user = userEvent.setup();
    render(<Field initial={['BMASC']} />);
    await user.click(screen.getByText('BMASC'));
    expect(screen.getByText('BMASC')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Eliminar alias BMASC'));
    expect(screen.queryByText('BMASC')).not.toBeInTheDocument();
  });

  it('shows informational case-insensitive guidance', () => {
    render(<Field />);
    expect(screen.getByRole('alert')).toHaveTextContent('Los alias no distinguen entre mayúsculas y minúsculas.');
    expect(screen.getByRole('alert')).toHaveTextContent('DAUBERT, Daubert y daubert');
  });

  it('shows other alias types with Spanish labels and no delete actions', () => {
    render(<Field otherAliases={[
      { alias: 'TRES GUERRAS', type: 'NOMBRE_ARCHIVO' },
      { alias: 'TRANSPORTES TRESGUERRAS', type: 'NOMBRE_CARPETA' },
      { alias: 'AUTOTRANSPORTES DE CARGA TRESGUERRAS', type: 'RAZON_SOCIAL' },
      { alias: 'ATCG', type: 'ABREVIATURA' },
      { alias: 'TRESGUERRAS ANTERIOR', type: 'RAZON_SOCIAL_HISTORICA' },
      { alias: 'TRESGUERRAS OTRO', type: 'OTRO' }
    ]} />);
    expect(screen.getByText('Otros alias registrados')).toBeInTheDocument();
    expect(screen.getByText('TRES GUERRAS · Nombre de archivo')).toBeInTheDocument();
    expect(screen.getByText('TRANSPORTES TRESGUERRAS · Nombre de carpeta')).toBeInTheDocument();
    expect(screen.getByText('AUTOTRANSPORTES DE CARGA TRESGUERRAS · Razón social')).toBeInTheDocument();
    expect(screen.getByText('ATCG · Abreviatura')).toBeInTheDocument();
    expect(screen.getByText('TRESGUERRAS ANTERIOR · Razón social histórica')).toBeInTheDocument();
    expect(screen.getByText('TRESGUERRAS OTRO · Otro')).toBeInTheDocument();
    expect(screen.queryByText(/NOMBRE_ARCHIVO|NOMBRE_CARPETA|RAZON_SOCIAL/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Eliminar alias TRES GUERRAS/)).not.toBeInTheDocument();
  });

  it('does not render an empty other-alias subsection', () => {
    render(<Field />);
    expect(screen.queryByText('Otros alias registrados')).not.toBeInTheDocument();
  });
});

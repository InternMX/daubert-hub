import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CompanyContactsSection } from './CompanyContactsSection';

describe('CompanyContactsSection', () => {
  it('renders the title, explanatory copy, and a link to the filtered contacts directory', () => {
    render(<MemoryRouter><CompanyContactsSection companyId="121" /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Contactos relacionados' })).toBeInTheDocument();
    expect(screen.getByText('Consulta y administra los contactos de esta empresa desde el directorio de contactos.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver contactos' })).toHaveAttribute('href', '/contacts?company=121');
  });

  it('preserves an exact BIGINT-style company id beyond Number.MAX_SAFE_INTEGER in the navigation target', () => {
    const companyId = '9007199254740993123';
    render(<MemoryRouter><CompanyContactsSection companyId={companyId} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Ver contactos' })).toHaveAttribute('href', `/contacts?company=${companyId}`);
  });
});

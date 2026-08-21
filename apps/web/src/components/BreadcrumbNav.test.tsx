import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BreadcrumbNav } from './BreadcrumbNav';

describe('BreadcrumbNav', () => {
  it('renders navigable ancestors and non-clickable current page text', () => {
    render(<MemoryRouter><BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores', to: '/providers?search=alma&page=2' }, { label: 'CONDESA' }]} /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Migas de pan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Proveedores' })).toHaveAttribute('href', '/providers?search=alma&page=2');
    expect(screen.getByText('CONDESA')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'CONDESA' })).not.toBeInTheDocument();
  });

  it('navigates to a preserved ancestor URL', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/providers/121']}><Routes><Route path="/providers/121" element={<BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Proveedores', to: '/providers?search=alma&page=2' }, { label: 'CONDESA' }]} />} /><Route path="/providers" element={<div>Directorio conservado</div>} /></Routes></MemoryRouter>);
    await user.click(screen.getByRole('link', { name: 'Proveedores' }));
    expect(screen.getByText('Directorio conservado')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from './App';

function renderApp(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

describe('application navigation', () => {
  it.each([['/', 'Inicio'], ['/providers', 'Proveedores'], ['/contacts', 'Contactos']])('renders %s', (path, title) => {
    renderApp(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  });

  it('renders Daubert Cromwell branding and the provider directory', async () => {
    renderApp('/providers');
    expect(screen.getByRole('img', { name: 'Daubert Cromwell' })).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar proveedor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nuevo proveedor' })).toHaveAttribute('href', '/providers/new');
  });

  it('navigates through every sidebar link', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('link', { name: 'Proveedores' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Contactos' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Contactos' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Inicio' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument();
  });

  it('opens the new provider flow from providers and home', async () => {
    const user = userEvent.setup();
    renderApp('/providers');
    await user.click(screen.getByRole('link', { name: 'Nuevo proveedor' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Nuevo proveedor' })).toBeInTheDocument();
  });
});

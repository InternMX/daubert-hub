import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContactMethodRow } from './ContactMethodRow';

const method = { id: '9007199254740993', type: 'WEB' as const, value: 'https://portal.example.test/login?company=31', isPrimary: false };

describe('ContactMethodRow WEB', () => {
  it('renders the exact stored URL as a safe external link', () => {
    render(<ContactMethodRow method={method} pending={false} readOnly />);
    const link = screen.getByRole('link', { name: method.value });
    expect(screen.getByText('Portal / página web:')).toBeInTheDocument();
    expect(link).toHaveAttribute('href', method.value);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does not create a link for an unsafe persisted WEB value', () => {
    render(<ContactMethodRow method={{ ...method, value: 'javascript:alert(1)' }} pending={false} readOnly />);
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('opens WEB editing with the persisted URL intact', async () => {
    render(<ContactMethodRow method={method} pending={false} onEdit={vi.fn()} onDeactivate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `Acciones para Portal / página web: ${method.value}` }));
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument();
  });

  it('preserves the URL in the inline editor', () => {
    render(<ContactMethodRow method={method} pending={false} editing onEditClose={vi.fn()} onEdited={vi.fn()} />);
    const form = screen.getByRole('form', { name: `Editar medio ${method.value}` });
    expect(within(form).getByRole('textbox', { name: 'URL' })).toHaveValue(method.value);
  });
});

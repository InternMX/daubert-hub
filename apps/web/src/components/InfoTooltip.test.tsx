import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InfoTooltip } from './InfoTooltip';

describe('InfoTooltip', () => {
  it('is a button with an accessible name that says what it explains', () => {
    render(<InfoTooltip label="Correo principal" text="Texto de ayuda" />);
    expect(screen.getByRole('button', { name: 'Información: Correo principal' })).toBeInTheDocument();
  });

  it('is reachable with the keyboard and shows the tooltip on focus (not only on hover)', async () => {
    const user = userEvent.setup();
    render(<InfoTooltip label="Correo principal" text="Texto de ayuda" />);
    await user.tab();
    const icon = screen.getByRole('button', { name: 'Información: Correo principal' });
    expect(icon).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Texto de ayuda');
    // The text is also exposed as the description, so it does not depend on the visual tooltip alone.
    expect(icon).toHaveAccessibleDescription('Texto de ayuda');
  });

  it('shows the tooltip on hover too and hides it on Escape', async () => {
    const user = userEvent.setup();
    render(<InfoTooltip label="X" text="Texto de ayuda" />);
    await user.hover(screen.getByRole('button', { name: 'Información: X' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Texto de ayuda');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('keeps line breaks for multi-line help (pre-line) and limits the width', async () => {
    const user = userEvent.setup();
    render(<InfoTooltip label="Lista" text={'PARA: uno.\nCC: dos.'} />);
    await user.tab();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('PARA: uno. CC: dos.');
    const surface = tooltip.querySelector('[class*="MuiTooltip-tooltip"]') ?? tooltip;
    expect(getComputedStyle(surface).whiteSpace).toBe('pre-line');
    expect(getComputedStyle(surface).maxWidth).toBe('360px');
  });

  it('never submits a surrounding form and does not act as a submit control', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<form onSubmit={onSubmit}><InfoTooltip label="X" text="t" /></form>);
    const icon = screen.getByRole('button', { name: 'Información: X' });
    expect(icon).toHaveAttribute('type', 'button');
    fireEvent.click(icon);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not change the neighbouring checkbox: clicking the icon leaves it untouched, and its name stays the label', async () => {
    const user = userEvent.setup();
    function Row() {
      const [checked, setChecked] = useState(false);
      return <div><label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />Correo principal</label><InfoTooltip label="Correo principal" text="t" /></div>;
    }
    const { container } = render(<Row />);
    const checkbox = within(container).getByRole('checkbox', { name: 'Correo principal' });
    await user.click(screen.getByRole('button', { name: 'Información: Correo principal' }));
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});

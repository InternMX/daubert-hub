import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionErrorDetailDialog, ExecutionErrorMessage, ExecutionErrorPreview } from './ExecutionErrorDetailDialog';
import { executionErrorCellSx, executionErrorPreviewSx } from './executionErrorPresentation';

const WINDOWS_PATH = 'C:\\Users\\06\\Documents\\Dropbox\\HERRAMIENTAS AUTOMATIZACION\\REMISIONES CAT\\05_ARCHIVOS AUXILIARES\\SCRIPTS\\convertir-cat-pdf.ps1';
const POWERSHELL_TRACE = [
  `Command failed: powershell -NoProfile -File "${WINDOWS_PATH}"`,
  'No se generó el PDF o quedó en 0 bytes: C:\\salidas\\REM 0113 89-S003183.pdf',
  `En ${WINDOWS_PATH}: 120 Carácter: 9`,
  '+         throw "No se generó el PDF"',
  '    + CategoryInfo          : OperationStopped: (:) [], RuntimeException',
  '    + FullyQualifiedErrorId : No se generó el PDF'
].join('\n');

function Harness({ message, node = 'Convertir PDF CAT' }: { message: string; node?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ExecutionErrorPreview executionId="27" message={message} onOpen={() => setOpen(true)} />
      <ExecutionErrorDetailDialog
        open={open}
        onClose={() => setOpen(false)}
        executionId="27"
        startedAt="6 nov 2026 · 13:10"
        filename="PROGRAMACIÓN DE ENTREGA CAT SC PLANTA 2.xlsx"
        processLabel="P2"
        status={<span>Con error</span>}
        errorNode={node}
        message={message}
      />
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('ExecutionErrorPreview', () => {
  it('shows an em dash and no action when there is no error', () => {
    render(<ExecutionErrorPreview executionId="1" message={null} onOpen={() => {}} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver error/ })).not.toBeInTheDocument();
  });

  it('treats an empty message like no error', () => {
    render(<ExecutionErrorPreview executionId="1" message="" onOpen={() => {}} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps a single-line message intact and offers "Ver error"', () => {
    render(<ExecutionErrorPreview executionId="9" message="Falló la conversión" onOpen={() => {}} />);
    expect(screen.getByText('Falló la conversión')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver error de la ejecución 9' })).toHaveTextContent('Ver error');
  });

  it('limits the preview to two lines and wraps unbreakable strings, without altering the text', () => {
    const long = 'X'.repeat(6000);
    render(<ExecutionErrorPreview executionId="27" message={long} onOpen={() => {}} />);
    expect(executionErrorPreviewSx.WebkitLineClamp).toBe(2);
    expect(executionErrorPreviewSx.overflow).toBe('hidden');
    expect(executionErrorPreviewSx.overflowWrap).toBe('anywhere');
    expect(executionErrorCellSx.maxWidth).toBeLessThanOrEqual(320);
    // CSS-only truncation: the full value is still what the DOM (and memory) holds.
    expect(screen.getByText(long)).toBeInTheDocument();
  });
});

describe('ExecutionErrorDetailDialog', () => {
  it('opens from "Ver error" with all execution fields and closes with "Cerrar"', async () => {
    const user = userEvent.setup();
    render(<Harness message={POWERSHELL_TRACE} />);
    const open = screen.getByRole('button', { name: 'Ver error de la ejecución 27' });
    await user.click(open);

    const dialog = await screen.findByRole('dialog', { name: 'Detalle del error — Ejecución #27' });
    expect(within(dialog).getByText('27')).toBeInTheDocument();
    expect(within(dialog).getByText('6 nov 2026 · 13:10')).toBeInTheDocument();
    expect(within(dialog).getByText('PROGRAMACIÓN DE ENTREGA CAT SC PLANTA 2.xlsx')).toBeInTheDocument();
    expect(within(dialog).getByText('P2')).toBeInTheDocument();
    expect(within(dialog).getByText('Con error')).toBeInTheDocument();
    expect(within(dialog).getByText('Convertir PDF CAT')).toBeInTheDocument();

    const closers = within(dialog).getAllByRole('button', { name: 'Cerrar' });
    expect(closers).toHaveLength(2); // header icon + footer button
    await user.click(closers[1]!);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes with Escape and returns focus to "Ver error"', async () => {
    const user = userEvent.setup();
    render(<Harness message="boom" />);
    const open = screen.getByRole('button', { name: 'Ver error de la ejecución 27' });
    await user.click(open);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await vi.waitFor(() => expect(open).toHaveFocus());
  });

  it('opens with the keyboard (Enter and Space)', async () => {
    const user = userEvent.setup();
    render(<Harness message="boom" />);
    const open = screen.getByRole('button', { name: 'Ver error de la ejecución 27' });
    open.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('shows the full message verbatim: line breaks, Windows paths and stack trace, scrollable and focusable', async () => {
    const user = userEvent.setup();
    render(<Harness message={POWERSHELL_TRACE} />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    const region = await screen.findByRole('region', { name: 'Mensaje de error completo' });
    expect(region.textContent).toBe(POWERSHELL_TRACE);
    expect(region.textContent).toContain(WINDOWS_PATH);
    expect(region.tagName).toBe('PRE');
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveStyle({ whiteSpace: 'pre-wrap', overflowY: 'auto' });
  });

  it('never truncates a message of more than 5,000 characters in the dialog', async () => {
    const user = userEvent.setup();
    const huge = `${'Error de Chrome Updater '.repeat(300)}FIN`;
    expect(huge.length).toBeGreaterThan(5000);
    render(<Harness message={huge} />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    expect((await screen.findByRole('region', { name: 'Mensaje de error completo' })).textContent).toBe(huge);
  });

  it('renders HTML found in an error as inert text', async () => {
    const user = userEvent.setup();
    const hostile = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    render(<Harness message={hostile} />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    const region = await screen.findByRole('region', { name: 'Mensaje de error completo' });
    expect(region.textContent).toBe(hostile);
    expect(region.querySelector('img, script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('copies the complete, unmodified message and confirms it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<Harness message={POWERSHELL_TRACE} />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    await user.click(await screen.findByRole('button', { name: 'Copiar error' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(POWERSHELL_TRACE);
    expect(await screen.findByText('Error copiado al portapapeles.')).toBeInTheDocument();
  });

  it('reports a copy failure instead of pretending it worked', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    render(<Harness message="boom" />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    await user.click(await screen.findByRole('button', { name: 'Copiar error' }));
    expect(await screen.findByText('No fue posible copiar el error.')).toBeInTheDocument();
  });

  it('shows "No disponible" when the error node is unknown', async () => {
    const user = userEvent.setup();
    render(<Harness message="boom" node={null} />);
    await user.click(screen.getByRole('button', { name: 'Ver error de la ejecución 27' }));
    expect(await screen.findByText('No disponible')).toBeInTheDocument();
  });
});

describe('ExecutionErrorMessage', () => {
  it('preserves line breaks exactly', () => {
    render(<ExecutionErrorMessage message={'línea 1\nlínea 2\n\nlínea 4'} />);
    expect(screen.getByRole('region', { name: 'Mensaje de error completo' }).textContent).toBe('línea 1\nlínea 2\n\nlínea 4');
  });
});

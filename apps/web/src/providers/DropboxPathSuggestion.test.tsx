import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDropboxPathSuggestion } from '../services/dropboxPathSuggestion';
import { getProvider, updateProvider } from '../services/providers';
import { EditProviderPage } from './EditProviderPage';
import { ProviderForm } from './ProviderForm';

vi.mock('../services/dropboxPathSuggestion', () => ({ getDropboxPathSuggestion: vi.fn() }));
vi.mock('../services/providers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/providers')>()), getProvider: vi.fn(), updateProvider: vi.fn() }));
const suggestionMock = vi.mocked(getDropboxPathSuggestion);
const getProviderMock = vi.mocked(getProvider);
const updateProviderMock = vi.mocked(updateProvider);

afterEach(() => vi.clearAllMocks());

const WAIT = { timeout: 3000 };
// The API owns the mapping; the tests fake it with a tiny stand-in so the UI behaviour can be checked.
function fakeApi() {
  suggestionMock.mockImplementation(async (type, name) => `${{ PROVEEDOR: 'PROVEEDORES', SERVICIO: 'PROVEEDOR DE SERVICIOS', FLETE: 'FLETES', CLIENTE: 'CLIENTES' }[type]}/${name}`);
}
async function selectType(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
  await user.click(screen.getByRole('option', { name: label }));
}
const nameField = () => screen.getByRole('textbox', { name: /Nombre comercial/ });
const pathField = () => screen.getByRole('textbox', { name: 'Ruta de Dropbox' });

describe('ProviderForm — Dropbox path suggestion', () => {
  it('asks for nothing until both the type and a non-blank name exist', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.type(nameField(), '   ');
    await selectType(user, 'Flete');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(suggestionMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Usar sugerencia')).not.toBeInTheDocument();
  });

  it('shows the backend suggestion for type + name (debounced, one request for the whole typing)', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'TRANSPORTES KARINA');
    expect(await screen.findByText('FLETES/TRANSPORTES KARINA', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Sugerencia:')).toBeInTheDocument();
    expect(suggestionMock).toHaveBeenCalledTimes(1);
    expect(suggestionMock.mock.calls[0]!.slice(0, 2)).toEqual(['FLETE', 'TRANSPORTES KARINA']);
  });

  it('"Usar sugerencia" copies it into the editable field and saves nothing', async () => {
    fakeApi();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'TRANSPORTES KARINA');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    expect(pathField()).toHaveValue('FLETES/TRANSPORTES KARINA');
    expect(onSubmit).not.toHaveBeenCalled();
    // The suggestion equals the field now: no redundant visual noise.
    expect(screen.queryByRole('button', { name: 'Usar sugerencia' })).not.toBeInTheDocument();
  });

  it('the field stays editable after using the suggestion', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Proveedor');
    await user.type(nameField(), 'ACME');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    await user.type(pathField(), ' NORTE');
    expect(pathField()).toHaveValue('PROVEEDORES/ACME NORTE');
  });

  it('changing the name updates the suggestion but never touches the field', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'KARINA');
    expect(await screen.findByText('FLETES/KARINA', undefined, WAIT)).toBeInTheDocument();
    await user.type(nameField(), ' EXPRESS');
    expect(await screen.findByText('FLETES/KARINA EXPRESS', undefined, WAIT)).toBeInTheDocument();
    expect(pathField()).toHaveValue('');
  });

  it('changing the type updates the suggestion but never touches the field', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'ACME');
    expect(await screen.findByText('FLETES/ACME', undefined, WAIT)).toBeInTheDocument();
    await selectType(user, 'Proveedor de servicios');
    expect(await screen.findByText('PROVEEDOR DE SERVICIOS/ACME', undefined, WAIT)).toBeInTheDocument();
    expect(pathField()).toHaveValue('');
  });

  it('does NOT overwrite a path the user typed by hand when a new suggestion arrives', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(pathField(), 'FLETES/MI CARPETA');
    await user.type(nameField(), 'KARINA');
    expect(await screen.findByText('FLETES/KARINA', undefined, WAIT)).toBeInTheDocument();
    await user.type(nameField(), ' EXPRESS');
    expect(await screen.findByText('FLETES/KARINA EXPRESS', undefined, WAIT)).toBeInTheDocument();
    expect(pathField()).toHaveValue('FLETES/MI CARPETA');
  });

  it('a manually edited path can still be replaced explicitly with the suggestion', async () => {
    fakeApi();
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(pathField(), 'OTRA/RUTA');
    await user.type(nameField(), 'KARINA');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    expect(pathField()).toHaveValue('FLETES/KARINA');
  });

  it('submit sends only the confirmed path: the accepted suggestion, or nothing when it was not accepted', async () => {
    fakeApi();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { unmount } = render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'KARINA');
    await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT);
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty('rutaDropbox');
    unmount();

    const second = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm onSubmit={second} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'KARINA');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(second).toHaveBeenCalledWith({ commercialName: 'KARINA', providerType: 'FLETE', fiscal: null, notes: null, rutaDropbox: 'FLETES/KARINA' });
    expect(Object.keys(second.mock.calls[0]![0])).not.toContain('suggestedDropboxPath');
  });

  it('a failing suggestion request is silent and never blocks the form', async () => {
    suggestionMock.mockRejectedValue(new Error('offline'));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), 'KARINA');
    await waitFor(() => expect(suggestionMock).toHaveBeenCalled(), WAIT);
    expect(screen.queryByRole('button', { name: 'Usar sugerencia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.type(pathField(), 'FLETES/KARINA');
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ rutaDropbox: 'FLETES/KARINA' }));
  });

  it('a null suggestion (nothing safe to propose) shows nothing', async () => {
    suggestionMock.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await selectType(user, 'Flete');
    await user.type(nameField(), '???');
    await waitFor(() => expect(suggestionMock).toHaveBeenCalled(), WAIT);
    expect(screen.queryByText('Sugerencia:')).not.toBeInTheDocument();
  });
});

describe('EditProviderPage — Dropbox path suggestion', () => {
  const provider = { id: '121', commercialName: 'TRANSPORTES KARINA', providerType: 'FLETE' as const, roles: ['FLETE'], status: 'ACTIVO', notes: null, rutaDropbox: 'FLETES/TRANSPORTES KARINA', aliases: [], otherAliases: [], fiscal: null };
  function renderPage() {
    return render(<MemoryRouter initialEntries={['/providers/121/edit']}><Routes><Route path="/providers/:id/edit" element={<EditProviderPage />} /><Route path="/providers/:id" element={<div>Detalle</div>} /></Routes></MemoryRouter>);
  }

  it('keeps the existing path and shows no suggestion when they are the same', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue(provider);
    renderPage();
    expect(await screen.findByRole('textbox', { name: 'Ruta de Dropbox' })).toHaveValue('FLETES/TRANSPORTES KARINA');
    await waitFor(() => expect(suggestionMock).toHaveBeenCalled(), WAIT);
    expect(screen.queryByRole('button', { name: 'Usar sugerencia' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('renaming the company shows the new suggestion but never changes the stored path', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue(provider);
    const user = userEvent.setup();
    renderPage();
    const name = await screen.findByRole('textbox', { name: /Nombre comercial/ });
    await user.type(name, ' EXPRESS');
    expect(await screen.findByText('FLETES/TRANSPORTES KARINA EXPRESS', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('Sugerencia según los datos actuales:')).toBeInTheDocument();
    expect(pathField()).toHaveValue('FLETES/TRANSPORTES KARINA');
  });

  it('changing the type shows the suggestion for the new type without touching the stored path', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue(provider);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('textbox', { name: 'Ruta de Dropbox' });
    await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
    await user.click(screen.getByRole('option', { name: 'Proveedor' }));
    expect(await screen.findByText('PROVEEDORES/TRANSPORTES KARINA', undefined, WAIT)).toBeInTheDocument();
    expect(pathField()).toHaveValue('FLETES/TRANSPORTES KARINA');
  });

  it('a different suggestion can be accepted explicitly, and saving then sends only that rutaDropbox', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider: provider as never, requestId: 'r' });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByRole('textbox', { name: /Nombre comercial/ }), ' EXPRESS');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    expect(pathField()).toHaveValue('FLETES/TRANSPORTES KARINA EXPRESS');
    expect(updateProviderMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledOnce());
    expect(updateProviderMock.mock.calls[0]![1]).toMatchObject({ commercialName: 'TRANSPORTES KARINA EXPRESS', rutaDropbox: 'FLETES/TRANSPORTES KARINA EXPRESS' });
  });

  it('renaming alone (suggestion ignored) saves the name without rutaDropbox: the stored path is explicit and kept', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue(provider);
    updateProviderMock.mockResolvedValue({ provider: provider as never, requestId: 'r' });
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByRole('textbox', { name: /Nombre comercial/ }), ' EXPRESS');
    await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT);
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledOnce());
    expect(updateProviderMock.mock.calls[0]![1]).not.toHaveProperty('rutaDropbox');
  });

  it('a company without a stored path can adopt the suggestion; a failing endpoint changes nothing', async () => {
    fakeApi();
    getProviderMock.mockResolvedValue({ ...provider, rutaDropbox: null });
    const user = userEvent.setup();
    const { unmount } = renderPage();
    expect(await screen.findByRole('textbox', { name: 'Ruta de Dropbox' })).toHaveValue('');
    await user.click(await screen.findByRole('button', { name: 'Usar sugerencia' }, WAIT));
    expect(pathField()).toHaveValue('FLETES/TRANSPORTES KARINA');
    unmount();

    suggestionMock.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByRole('textbox', { name: 'Ruta de Dropbox' })).toHaveValue('');
    await waitFor(() => expect(suggestionMock).toHaveBeenCalledTimes(2), WAIT);
    expect(screen.queryByRole('button', { name: 'Usar sugerencia' })).not.toBeInTheDocument();
  });
});

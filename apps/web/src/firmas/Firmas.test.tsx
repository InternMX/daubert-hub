import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from '../account/ProfilePage';
import { AdminRoute } from '../auth/RouteGuards';
import { TestAuthProvider, testAdminUser, testGeneralUser } from '../test/authTestUtils';
import * as docs from '../services/manufacturingDocuments';
import { getUser, type ManagedUser } from '../services/users';
import { UserDetailPage } from '../users/UserDetailPage';
import { UserSignaturesPage } from '../users/UserSignaturesPage';

vi.mock('../services/manufacturingDocuments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/manufacturingDocuments')>()),
  capacidadesDocumentales: vi.fn(), listarFirmas: vi.fn(), subirFirma: vi.fn(), listarRevisores: vi.fn(), autorizacionesDeFirma: vi.fn(), autorizarUsoDeFirma: vi.fn(),
  revocarUsoDeFirma: vi.fn(), listarFirmasAdministrativas: vi.fn(), retirarFirma: vi.fn()
}));
vi.mock('../services/users', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/users')>()), getUser: vi.fn() }));
const m = vi.mocked(docs);

// Gestión de firmas fuera del formulario de manufactura: «Mi perfil» (cualquier usuario) y Usuarios (solo ADMIN, solo descripción).
const MIA = { id: 'f0000000-0000-4000-8000-0000000000a1', propietario: 'Ana Ruiz', propia: true, ancho: 300, alto: 100, miniatura: 'data:image/png;base64,AAAA', creadaEn: '2026-11-03T10:00:00Z' };
const AJENA = { id: 'f0000000-0000-4000-8000-0000000000b2', propietario: 'General Tres', propia: false, ancho: 300, alto: 100, miniatura: 'data:image/png;base64,BBBB', creadaEn: '2026-11-03T10:00:00Z' };
const USUARIOS = [{ id: '2', displayName: 'Ana Ruiz' }, { id: '3', displayName: 'General Tres' }, { id: '4', displayName: 'Maria Lopez' }];
const aut = (usuarioId: string, nombre: string) => ({ usuarioId, nombre, otorgadaEn: '2026-11-03T11:00:00Z', otorgadaPor: 'Ana Ruiz' });

beforeEach(() => {
  m.capacidadesDocumentales.mockResolvedValue({ firmas: true });
  m.listarFirmas.mockResolvedValue({ data: [MIA, AJENA] });
  m.listarRevisores.mockResolvedValue({ data: USUARIOS });
  m.autorizacionesDeFirma.mockResolvedValue({ data: [] });
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:vista', configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, configurable: true });
});
afterEach(() => { vi.clearAllMocks(); });

const conSesion = (usuario: typeof testGeneralUser, ui: ReactNode, ruta = '/') => render(<TestAuthProvider value={{ user: usuario }}><MemoryRouter initialEntries={[ruta]}>{ui}</MemoryRouter></TestAuthProvider>);
const ana = { ...testGeneralUser, id: '2', displayName: 'Ana Ruiz' };

describe('Mi perfil → Mis firmas (usuario GENERAL)', () => {
  it('muestra la información básica de la cuenta y separa las firmas propias de las que otras personas autorizaron', async () => {
    conSesion(ana, <ProfilePage />);
    const cuenta = screen.getByRole('region', { name: 'Información de la cuenta' });
    expect(within(cuenta).getByText('Ana Ruiz')).toBeInTheDocument();
    expect(within(cuenta).getByText(testGeneralUser.email)).toBeInTheDocument();
    expect(within(cuenta).getByText('General')).toBeInTheDocument();
    const propias = await screen.findAllByTestId('firma-propia');
    expect(propias).toHaveLength(1);
    expect(within(propias[0]!).getByAltText('Firma de Ana Ruiz')).toHaveAttribute('src', MIA.miniatura);
    const autorizadas = screen.getAllByTestId('firma-autorizada');
    expect(autorizadas).toHaveLength(1);
    expect(within(autorizadas[0]!).getByText('General Tres')).toBeInTheDocument();
    expect(within(autorizadas[0]!).getByText('Uso autorizado')).toBeInTheDocument();
    expect(within(autorizadas[0]!).queryByRole('button')).toBeNull();                          // las ajenas no se administran
  });

  it('sin catálogo en el entorno (p. ej. producción) se informa y no se llama a nada más', async () => {
    m.capacidadesDocumentales.mockResolvedValue({ firmas: false });
    conSesion(ana, <ProfilePage />);
    expect(await screen.findByText('El catálogo de firmas no está disponible en este entorno.')).toBeInTheDocument();
    expect(m.listarFirmas).not.toHaveBeenCalled();
  });

  it('registra una firma propia (vista previa, sin elegir propietario) y vuelve a cargar la lista', async () => {
    const user = userEvent.setup();
    m.subirFirma.mockResolvedValue({ ...MIA, id: 'f0000000-0000-4000-8000-0000000000cc' });
    conSesion(ana, <ProfilePage />);
    await screen.findAllByTestId('firma-propia');
    await user.click(screen.getByRole('button', { name: 'Registrar nueva firma' }));
    const formulario = screen.getByTestId('nueva-firma');
    fireEvent.change(within(formulario).getByLabelText('Archivo de la firma'), { target: { files: [new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' })] } });
    expect(await within(formulario).findByAltText('Vista previa de la firma')).toHaveAttribute('src', 'blob:vista');
    await user.click(within(formulario).getByRole('button', { name: 'Guardar firma' }));
    await waitFor(() => expect(m.subirFirma).toHaveBeenCalledTimes(1));
    expect(m.subirFirma).toHaveBeenCalledWith(expect.not.objectContaining({ propietarioUsuarioId: expect.anything() }));
    await waitFor(() => expect(m.listarFirmas).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('nueva-firma')).toBeNull();
  });

  it('rechaza localmente SVG y archivos grandes y muestra el motivo del servidor cuando rechaza el contenido', async () => {
    const user = userEvent.setup();
    conSesion(ana, <ProfilePage />);
    await screen.findAllByTestId('firma-propia');
    await user.click(screen.getByRole('button', { name: 'Registrar nueva firma' }));
    const f = screen.getByTestId('nueva-firma');
    const entrada = within(f).getByLabelText('Archivo de la firma');
    fireEvent.change(entrada, { target: { files: [new File(['<svg/>'], 'f.svg', { type: 'image/svg+xml' })] } });
    expect(await within(f).findByRole('alert')).toHaveTextContent('Solo se aceptan imágenes JPG o PNG');
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'g.png', { type: 'image/png' })] } });
    expect(await within(f).findByRole('alert')).toHaveTextContent('máximo 2 MB');
    m.subirFirma.mockRejectedValue(new docs.DocumentApiError('FIRMA_INVALIDA', 400, { code: 'FIRMA_INVALIDA', message: 'La imagen está vacía (totalmente transparente).' }));
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' })] } });
    await user.click(await within(f).findByRole('button', { name: 'Guardar firma' }));
    expect(await within(f).findByRole('alert')).toHaveTextContent('La imagen está vacía');
  });

  it('el propietario ve quién puede usar su firma, busca por nombre, autoriza y revoca sin depender del administrador', async () => {
    const user = userEvent.setup();
    m.autorizacionesDeFirma.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [aut('3', 'General Tres')] }).mockResolvedValue({ data: [] });
    m.autorizarUsoDeFirma.mockResolvedValue({ ok: true });
    m.revocarUsoDeFirma.mockResolvedValue({ ok: true });
    conSesion(ana, <ProfilePage />);
    const tarjeta = (await screen.findAllByTestId('firma-propia'))[0]!;
    await user.click(within(tarjeta).getByRole('button', { name: 'Quién puede usarla' }));
    expect(await within(tarjeta).findByText('Solo tú. Nadie más puede usarla.')).toBeInTheDocument();
    await user.type(within(tarjeta).getByLabelText('Buscar persona'), 'tres');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['General Tres']);   // no se ofrece a sí mismo
    await user.click(screen.getByRole('option', { name: 'General Tres' }));
    await user.click(within(tarjeta).getByRole('button', { name: 'Autorizar uso' }));
    await waitFor(() => expect(m.autorizarUsoDeFirma).toHaveBeenCalledWith(MIA.id, '3'));
    expect(await within(tarjeta).findByTestId('autorizado')).toHaveTextContent('General Tres');
    expect(within(tarjeta).getByText(/no aprueba ningún documento/)).toBeInTheDocument();
    await user.click(within(tarjeta).getByRole('button', { name: 'Revocar el uso a General Tres' }));
    await waitFor(() => expect(m.revocarUsoDeFirma).toHaveBeenCalledWith(MIA.id, '3'));
    expect(await within(tarjeta).findByText(/los PDF ya finalizados no cambian/)).toBeInTheDocument();
    expect(within(tarjeta).queryByTestId('autorizado')).toBeNull();
  });

  it('un error del servidor al autorizar se explica y no se pierde el resto', async () => {
    const user = userEvent.setup();
    m.autorizarUsoDeFirma.mockRejectedValue(new docs.DocumentApiError('FORBIDDEN', 403, {}));
    conSesion(ana, <ProfilePage />);
    const tarjeta = (await screen.findAllByTestId('firma-propia'))[0]!;
    await user.click(within(tarjeta).getByRole('button', { name: 'Quién puede usarla' }));
    await user.click(await within(tarjeta).findByLabelText('Buscar persona'));
    await user.click(await screen.findByRole('option', { name: 'Maria Lopez' }));
    await user.click(within(tarjeta).getByRole('button', { name: 'Autorizar uso' }));
    expect(await within(tarjeta).findByText('No tienes permiso para esta operación.')).toBeInTheDocument();
  });
});

const otro: ManagedUser = { id: '3', displayName: 'General Tres', email: 'g3@daubertcromwell.com', role: 'GENERAL', status: 'ACTIVE', mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', lastLoginAt: null };
const filaAdmin = (o: Partial<docs.FirmaAdministrativa> = {}): docs.FirmaAdministrativa => ({ id: 'f0000000-0000-4000-8000-0000000000d1', propietarioUsuarioId: '3', propietario: 'General Tres', cuenta: 'ACTIVE', estado: 'ACTIVA', creadaEn: '2026-11-03T10:00:00Z', retiradaEn: null, subidaPor: 'Alejandro López', incorporadaPor: 'Alejandro López', autorizaciones: null, registradaPorMi: true, ...o });
const alcance = 'Solo se listan las firmas que esta cuenta registró o cuyo uso tiene autorizado: ser ADMIN no da acceso a las firmas de otras personas.';

function detalle(usuario = otro) {
  vi.mocked(getUser).mockResolvedValue(usuario);
  return conSesion(testAdminUser, <Routes><Route path="/users/:userId" element={<UserDetailPage />} /></Routes>, `/users/${usuario.id}`);
}

describe('Usuarios → detalle → Firmas (ADMIN, solo descripción)', () => {
  it('lista las firmas registradas a nombre del usuario con propietario, cuenta, fecha, quién registró y estado, SIN mostrar ninguna imagen ni administrar su uso', async () => {
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [filaAdmin(), filaAdmin({ id: 'f0000000-0000-4000-8000-0000000000d2', estado: 'RETIRADA', retiradaEn: '2026-11-04T10:00:00Z' })], alcance });
    detalle();
    const seccion = await screen.findByTestId('firmas-admin');
    const filas = await within(seccion).findAllByTestId('firma-admin');
    expect(filas).toHaveLength(2);
    expect(within(filas[0]!).getByText('General Tres')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('Cuenta activa')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('Alejandro López')).toBeInTheDocument();
    expect(within(filas[0]!).getByText('Activa')).toBeInTheDocument();
    expect(within(filas[1]!).getByText(/Retirada el/)).toBeInTheDocument();
    expect(within(seccion).queryByRole('img')).toBeNull();                                      // nunca imágenes
    expect(within(seccion).queryByRole('button', { name: /Quién puede usarla|Autorizar|Revocar/ })).toBeNull();   // la propietaria gobierna el uso
    expect(within(seccion).getByText(/ser ADMIN no da acceso a las firmas de otras personas/)).toBeInTheDocument();
    expect(m.listarFirmasAdministrativas).toHaveBeenCalledWith({ propietarioUsuarioId: '3' }, expect.anything());
    expect(m.listarFirmas).not.toHaveBeenCalled();                                              // no usa el catálogo de uso
  });

  it('el ADMIN registra una firma en nombre del usuario: se envía el propietario, no recibe permiso de uso y se le explica', async () => {
    const user = userEvent.setup();
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [], alcance });
    m.subirFirma.mockResolvedValue({ ...AJENA, utilizable: false });
    detalle();
    const seccion = await screen.findByTestId('firmas-admin');
    await user.click(await within(seccion).findByRole('button', { name: 'Registrar firma para este usuario' }));
    expect(within(seccion).getByText(/Registrarla no te da permiso de uso: solo General Tres puede autorizarlo/)).toBeInTheDocument();
    fireEvent.change(within(seccion).getByLabelText('Archivo de la firma'), { target: { files: [new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' })] } });
    await user.click(await within(seccion).findByRole('button', { name: 'Guardar firma' }));
    await waitFor(() => expect(m.subirFirma).toHaveBeenCalledWith(expect.objectContaining({ propietarioUsuarioId: '3' })));
    expect(await within(seccion).findByRole('status')).toHaveTextContent('Registrarla no te da permiso de uso: solo General Tres puede autorizarlo desde Mi perfil.');
    expect(m.autorizarUsoDeFirma).not.toHaveBeenCalled();                                       // ninguna autorización automática
    await waitFor(() => expect(m.listarFirmasAdministrativas).toHaveBeenCalledTimes(2));
  });

  it('identifica las firmas de una cuenta inactiva y no permite registrar nuevas para ella', async () => {
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [filaAdmin({ cuenta: 'INACTIVE' })], alcance });
    detalle({ ...otro, status: 'INACTIVE' });
    const seccion = await screen.findByTestId('firmas-admin');
    expect(await within(seccion).findByText('Cuenta inactiva')).toBeInTheDocument();
    expect(within(seccion).getByText('No se pueden registrar firmas para una cuenta inactiva.')).toBeInTheDocument();
    expect(within(seccion).queryByRole('button', { name: 'Registrar firma para este usuario' })).toBeNull();
  });

  it('«Retirar» solo se ofrece en las firmas que esta cuenta registró: las que registró otra persona se ven (descripción) pero no se pueden retirar desde aquí', async () => {
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [filaAdmin({ registradaPorMi: false, incorporadaPor: 'General Tres' }), filaAdmin({ id: 'f0000000-0000-4000-8000-0000000000d3', registradaPorMi: true })], alcance });
    detalle();
    const filas = await screen.findAllByTestId('firma-admin');
    expect(within(filas[0]!).queryByRole('button', { name: /Retirar/ })).toBeNull();
    expect(within(filas[1]!).getByRole('button', { name: /Retirar/ })).toBeInTheDocument();
  });

  it('retirar una firma pide confirmación y avisa que las revisiones finalizadas no cambian', async () => {
    const user = userEvent.setup();
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [filaAdmin()], alcance });
    m.retirarFirma.mockResolvedValue({ ok: true });
    detalle();
    await user.click(await screen.findByRole('button', { name: 'Retirar la firma de General Tres' }));
    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('no cambian');
    await user.click(within(dialogo).getByRole('button', { name: 'Retirar' }));
    await waitFor(() => expect(m.retirarFirma).toHaveBeenCalledWith('f0000000-0000-4000-8000-0000000000d1'));
  });
});

describe('Usuarios → Firmas de personas sin cuenta (ADMIN custodio)', () => {
  const custodia = filaAdmin({ id: 'f0000000-0000-4000-8000-0000000000e1', propietarioUsuarioId: null, propietario: 'Persona Externa', cuenta: 'SIN_CUENTA', incorporadaPor: 'Alejandro López', autorizaciones: 1 });

  it('localiza las firmas bajo custodia con su cuenta «sin cuenta», registra una nueva con el nombre de la persona y gestiona quién puede usarla', async () => {
    const user = userEvent.setup();
    m.listarFirmasAdministrativas.mockResolvedValue({ data: [custodia], alcance });
    m.subirFirma.mockResolvedValue({ ...AJENA, propietario: 'Otra Persona', utilizable: true });
    m.autorizacionesDeFirma.mockResolvedValue({ data: [aut(testAdminUser.id, 'Alejandro López')] });
    conSesion(testAdminUser, <UserSignaturesPage />);
    const fila = await screen.findByTestId('firma-admin');
    expect(within(fila).getByText('Persona Externa')).toBeInTheDocument();
    expect(within(fila).getByText('Sin cuenta (custodia)')).toBeInTheDocument();
    expect(m.listarFirmasAdministrativas).toHaveBeenCalledWith({ sinCuenta: true }, expect.anything());
    await user.click(within(fila).getByRole('button', { name: 'Quién puede usarla' }));
    expect(await screen.findByTestId('autorizado')).toHaveTextContent('Alejandro López (custodio)');
    await user.click(screen.getByRole('button', { name: 'Registrar firma de una persona sin cuenta' }));
    const formulario = screen.getByTestId('nueva-firma');
    fireEvent.change(within(formulario).getByLabelText('Archivo de la firma'), { target: { files: [new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' })] } });
    expect(within(formulario).getByRole('button', { name: 'Guardar firma' })).toBeDisabled();       // falta el nombre de la persona
    await user.type(within(formulario).getByLabelText('Nombre de la persona'), 'Otra Persona');
    await user.click(within(formulario).getByRole('button', { name: 'Guardar firma' }));
    await waitFor(() => expect(m.subirFirma).toHaveBeenCalledWith(expect.objectContaining({ propietarioNombre: 'Otra Persona' })));
  });
});

describe('acceso: las pantallas administrativas solo para ADMIN', () => {
  const rutas = (
    <Routes>
      <Route path="/" element={<p>Inicio</p>} />
      <Route element={<AdminRoute />}><Route path="/users/signatures" element={<UserSignaturesPage />} /><Route path="/users/:userId" element={<UserDetailPage />} /></Route>
      <Route path="/profile" element={<ProfilePage />} />
    </Routes>
  );
  it('un usuario GENERAL es redirigido y no se consulta nada administrativo', async () => {
    conSesion(ana, rutas, '/users/signatures');
    expect(await screen.findByText('Inicio')).toBeInTheDocument();
    expect(m.listarFirmasAdministrativas).not.toHaveBeenCalled();
    conSesion(ana, rutas, '/users/3');
    await waitFor(() => expect(screen.getAllByText('Inicio').length).toBeGreaterThan(1));
    expect(m.listarFirmasAdministrativas).not.toHaveBeenCalled();
  });

  it('el mismo usuario GENERAL sí accede a Mi perfil', async () => {
    conSesion(ana, rutas, '/profile');
    expect(await screen.findByRole('heading', { name: 'Mi perfil' })).toBeInTheDocument();
  });
});

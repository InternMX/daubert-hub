import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyPaymentNotificationSettingsSection } from '../companies/CompanyPaymentNotificationSettingsSection';
import { AddContactMethodForm } from '../contacts/AddContactMethodForm';
import { EditContactMethodForm } from '../contacts/EditContactMethodForm';
import { PaymentNotificationFields, type PaymentNotificationFieldsValue } from '../contacts/PaymentNotificationFields';
import { DropboxPathField } from '../providers/DropboxPathField';
import { ProviderForm } from '../providers/ProviderForm';
import { getDropboxPathSuggestion } from '../services/dropboxPathSuggestion';
import { getPaymentNotificationSettings, updatePaymentNotificationSettings } from '../services/paymentNotificationSettings';
import { addContactMethod, editContactMethod } from '../services/contactMethods';
import {
  CALCULATED_DESTINATION_HELP,
  DROPBOX_PATH_HELP,
  DROPBOX_SUGGESTION_HELP,
  GENERATE_DRAFTS_HELP,
  PAYMENT_NOTIFICATIONS_HELP,
  PRIMARY_EMAIL_HELP,
  PROCESSES_RECEIPTS_HELP,
  RECIPIENT_TYPE_HELP
} from './paymentNotificationHelp';

vi.mock('../services/dropboxPathSuggestion', () => ({ getDropboxPathSuggestion: vi.fn() }));
vi.mock('../services/paymentNotificationSettings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/paymentNotificationSettings')>()), getPaymentNotificationSettings: vi.fn(), updatePaymentNotificationSettings: vi.fn() }));
vi.mock('../services/contactMethods', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/contactMethods')>()), addContactMethod: vi.fn(), editContactMethod: vi.fn() }));

const suggestionMock = vi.mocked(getDropboxPathSuggestion);
const getSettingsMock = vi.mocked(getPaymentNotificationSettings);
const updateSettingsMock = vi.mocked(updatePaymentNotificationSettings);

afterEach(() => vi.clearAllMocks());

const WAIT = { timeout: 3000 };
const icon = (label: string) => screen.getByRole('button', { name: `Información: ${label}` });

async function expectTooltipOnFocus(label: string, text: string) {
  const user = userEvent.setup();
  icon(label).focus();
  expect(icon(label)).toHaveFocus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent(text.replace(/\n/g, ' '));
  expect(icon(label)).toHaveAccessibleDescription(text);
  await user.keyboard('{Escape}');
}

describe('help texts (exact wording)', () => {
  it('matches the agreed copy', () => {
    expect(PRIMARY_EMAIL_HELP).toBe('Indica si este es el correo principal del contacto. Es independiente de las Notificaciones de Pago; un correo puede ser principal y no recibir notificaciones de pago, o viceversa.');
    expect(PAYMENT_NOTIFICATIONS_HELP).toBe('Configura si este correo participará en los avisos de pago. Esta configuración es independiente de que sea el correo principal del contacto.');
    expect(RECIPIENT_TYPE_HELP).toBe('PARA: destinatario principal del correo.\nCC: recibe una copia visible para los demás destinatarios.\nCCO: recibe una copia oculta.\nPara mantener activas las Notificaciones de Pago, la empresa debe tener al menos un destinatario PARA activo.');
    expect(DROPBOX_PATH_HELP).toBe('Ruta relativa dentro del Dropbox de Daubert que utilizará esta empresa. No incluyas una ruta absoluta, letra de unidad ni el prefijo Dropbox.');
    expect(DROPBOX_SUGGESTION_HELP).toBe("El Hub calcula esta ruta usando el tipo de empresa y su nombre comercial. Es solo una sugerencia: no comprueba si la carpeta existe en Dropbox, no crea carpetas y no modifica la ruta actual hasta que selecciones 'Usar sugerencia' y guardes los cambios.");
    expect(PROCESSES_RECEIPTS_HELP).toBe('Indica que esta empresa puede ser considerada al procesar comprobantes de pago. Esta opción no activa por sí sola la generación de notificaciones.');
    expect(GENERATE_DRAFTS_HELP).toBe('Permite que la automatización genere las notificaciones de pago para esta empresa. Para activarlo se requiere una ruta Dropbox, procesamiento habilitado y al menos un destinatario PARA activo.');
    expect(CALCULATED_DESTINATION_HELP).toBe('Ruta que utilizará la automatización para organizar los comprobantes. Se genera automáticamente a partir de la Ruta Dropbox y no se edita manualmente.');
  });
});

describe('PaymentNotificationFields — tooltips', () => {
  const off: PaymentNotificationFieldsValue = { isPrimary: false, receivesPaymentNotifications: false, paymentRecipientType: null };
  const on: PaymentNotificationFieldsValue = { isPrimary: false, receivesPaymentNotifications: true, paymentRecipientType: 'PARA' };

  it('shows "Correo principal" and "Notificaciones de Pago" icons, and the recipient-type icon only once "Recibe" is on', () => {
    const { rerender } = render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={off} disabled={false} onChange={vi.fn()} />);
    expect(icon('Correo principal')).toBeInTheDocument();
    expect(icon('Notificaciones de Pago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Información: Tipo de destinatario' })).not.toBeInTheDocument();
    rerender(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={vi.fn()} />);
    expect(icon('Tipo de destinatario')).toBeInTheDocument();
  });

  it('there is no icon on "Recibe notificaciones de pago" (the heading already explains it)', () => {
    render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Información: Recibe notificaciones de pago' })).not.toBeInTheDocument();
  });

  it.each([
    ['Correo principal', PRIMARY_EMAIL_HELP],
    ['Notificaciones de Pago', PAYMENT_NOTIFICATIONS_HELP],
    ['Tipo de destinatario', RECIPIENT_TYPE_HELP]
  ])('the "%s" tooltip opens on keyboard focus with the agreed text', async (label, text) => {
    render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={vi.fn()} />);
    await expectTooltipOnFocus(label, text);
  });

  it('the recipient tooltip explains PARA, CC and CCO and the "at least one PARA" rule', async () => {
    render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={vi.fn()} />);
    icon('Tipo de destinatario').focus();
    const tooltip = await screen.findByRole('tooltip');
    for (const fragment of ['PARA: destinatario principal del correo.', 'CC: recibe una copia visible', 'CCO: recibe una copia oculta.', 'al menos un destinatario PARA activo']) expect(tooltip).toHaveTextContent(fragment);
  });

  it('labels stay associated with their controls (icons live outside the labels)', () => {
    render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Correo principal' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Recibe notificaciones de pago' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Tipo de destinatario' })).toHaveTextContent('PARA');
  });

  it('interacting with the icons never changes the controls; the controls keep working', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PaymentNotificationFields idPrefix="t" type="CORREO" value={on} disabled={false} onChange={onChange} />);
    await user.click(icon('Correo principal'));
    await user.click(icon('Notificaciones de Pago'));
    await user.click(icon('Tipo de destinatario'));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'Correo principal' }));
    expect(onChange).toHaveBeenCalledWith({ ...on, isPrimary: true });
  });

  it('non-email methods render neither controls nor icons', () => {
    render(<PaymentNotificationFields idPrefix="t" type="TELEFONO" value={off} disabled={false} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Información/ })).not.toBeInTheDocument();
  });
});

describe('contact method forms — icons on add and edit', () => {
  it('the add form shows the "Correo principal" and "Notificaciones de Pago" icons for CORREO and submits exactly as before', async () => {
    vi.mocked(addContactMethod).mockResolvedValue({ id: '1', type: 'CORREO', value: 'a@example.test', status: 'ACTIVO' });
    render(<AddContactMethodForm contact={{ id: '9', label: 'María' }} onClose={vi.fn()} onAdded={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Agregar medio para María' });
    expect(within(form).getByRole('button', { name: 'Información: Correo principal' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Información: Notificaciones de Pago' })).toBeInTheDocument();
    fireEvent.change(within(form).getByRole('textbox', { name: 'Valor' }), { target: { value: 'a@example.test' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Agregar' }));
    await vi.waitFor(() => expect(addContactMethod).toHaveBeenCalledWith('9', { type: 'CORREO', value: 'a@example.test' }));
  });

  it('the edit form shows the same icons and, with "Recibe" on, the recipient-type icon', async () => {
    vi.mocked(editContactMethod).mockResolvedValue({ id: '5', type: 'CORREO', value: 'a@example.test', status: 'ACTIVO' });
    render(<EditContactMethodForm method={{ id: '5', type: 'CORREO', value: 'a@example.test', isPrimary: false, receivesPaymentNotifications: true, paymentRecipientType: 'CC' }} onClose={vi.fn()} onEdited={vi.fn()} />);
    const form = screen.getByRole('form', { name: 'Editar medio a@example.test' });
    expect(within(form).getByRole('button', { name: 'Información: Correo principal' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Información: Notificaciones de Pago' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Información: Tipo de destinatario' })).toBeInTheDocument();
    // Not dirty just for having icons; the type select still works.
    expect(within(form).getByRole('button', { name: 'Guardar' })).toBeDisabled();
    fireEvent.mouseDown(within(form).getByRole('combobox', { name: 'Tipo de destinatario' }));
    fireEvent.click(await screen.findByRole('option', { name: 'CCO' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(editContactMethod).toHaveBeenCalledWith('5', { receivesPaymentNotifications: true, paymentRecipientType: 'CCO' }));
  });
});

describe('DropboxPathField — tooltips', () => {
  function Field({ value = '', onChange = vi.fn() }: { value?: string; onChange?: (value: string) => void }) {
    return <DropboxPathField value={value} onChange={onChange} helperText="ayuda" companyType="FLETE" commercialName="KARINA" suggestionLabel="Sugerencia de ruta" />;
  }

  it('the path icon sits by the "Ruta de Dropbox" input, keeps its label association and opens on focus', async () => {
    suggestionMock.mockResolvedValue(null);
    render(<Field />);
    expect(screen.getByRole('textbox', { name: 'Ruta de Dropbox' })).toBeInTheDocument();
    await expectTooltipOnFocus('Ruta de Dropbox', DROPBOX_PATH_HELP);
  });

  it('typing in the field is unaffected by the icon', async () => {
    suggestionMock.mockResolvedValue(null);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field onChange={onChange} />);
    await user.click(icon('Ruta de Dropbox'));
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('the suggestion box says "Sugerencia de ruta", has its own icon, and the button still needs an explicit click', async () => {
    suggestionMock.mockResolvedValue('FLETES/KARINA');
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    expect(await screen.findByText('Sugerencia de ruta', undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText('FLETES/KARINA')).toBeInTheDocument();
    // Showing (and explaining) the suggestion applies nothing.
    expect(onChange).not.toHaveBeenCalled();
    await expectTooltipOnFocus('Sugerencia de ruta', DROPBOX_SUGGESTION_HELP);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Usar sugerencia' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('FLETES/KARINA');
  });

  it('clicking the suggestion icon does not apply the suggestion or overwrite an existing path', async () => {
    suggestionMock.mockResolvedValue('FLETES/KARINA NUEVA');
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Field value="FLETES/KARINA" onChange={onChange} />);
    await screen.findByText('FLETES/KARINA NUEVA', undefined, WAIT);
    await user.click(icon('Sugerencia de ruta'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Ruta de Dropbox' })).toHaveValue('FLETES/KARINA');
  });

  it('the provider form still validates and submits the path exactly as before', async () => {
    suggestionMock.mockResolvedValue(null);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Información: Ruta de Dropbox' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Nombre comercial/ }), 'X');
    await user.click(screen.getByRole('combobox', { name: /Tipo de proveedor/ }));
    await user.click(screen.getByRole('option', { name: 'Flete' }));
    await user.type(screen.getByRole('textbox', { name: 'Ruta de Dropbox' }), '  FLETES/X  ');
    await user.click(screen.getByRole('button', { name: 'Guardar proveedor' }));
    expect(onSubmit).toHaveBeenCalledWith({ commercialName: 'X', providerType: 'FLETE', fiscal: null, notes: null, rutaDropbox: 'FLETES/X' });
  });
});

describe('CompanyPaymentNotificationSettingsSection — tooltips', () => {
  const settings = { companyId: '7', dropboxPath: 'FLETES/KARINA', processesPaymentReceipts: false, notificationsActive: false, destinationPath: 'FLETES\\KARINA\\PAGOS', readiness: { ready: false, missingRequirements: ['PAYMENT_PROCESSING_REQUIRED' as const] } };

  it('adds icons only to the switches and the calculated destination (none on the readiness block, which is already explicit)', async () => {
    getSettingsMock.mockResolvedValue(settings);
    render(<MemoryRouter><CompanyPaymentNotificationSettingsSection companyId="7" /></MemoryRouter>);
    await screen.findByRole('switch', { name: 'Procesa comprobantes' });
    expect(icon('Procesa comprobantes')).toBeInTheDocument();
    expect(icon('Generar borradores')).toBeInTheDocument();
    expect(icon('Destino calculado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Información: Estado de preparación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Información: Ruta Dropbox' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Información:/ })).toHaveLength(3);
  });

  it.each([
    ['Procesa comprobantes', PROCESSES_RECEIPTS_HELP],
    ['Generar borradores', GENERATE_DRAFTS_HELP],
    ['Destino calculado', CALCULATED_DESTINATION_HELP]
  ])('the "%s" tooltip opens on keyboard focus', async (label, text) => {
    getSettingsMock.mockResolvedValue(settings);
    render(<MemoryRouter><CompanyPaymentNotificationSettingsSection companyId="7" /></MemoryRouter>);
    await screen.findByRole('switch', { name: 'Procesa comprobantes' });
    await expectTooltipOnFocus(label, text);
  });

  it('the switches keep their names and behaviour; the icons never toggle them or call the API', async () => {
    getSettingsMock.mockResolvedValue(settings);
    updateSettingsMock.mockResolvedValue({ ...settings, processesPaymentReceipts: true });
    const user = userEvent.setup();
    render(<MemoryRouter><CompanyPaymentNotificationSettingsSection companyId="7" /></MemoryRouter>);
    const processes = await screen.findByRole('switch', { name: 'Procesa comprobantes' });
    await user.click(icon('Procesa comprobantes'));
    await user.click(icon('Generar borradores'));
    expect(processes).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Generar borradores' })).not.toBeChecked();
    expect(updateSettingsMock).not.toHaveBeenCalled();
    await user.click(processes);
    expect(updateSettingsMock).toHaveBeenCalledWith('7', { processesPaymentReceipts: true });
  });
});

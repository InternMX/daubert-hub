import { Add, Close } from '@mui/icons-material';
import { Alert, Box, Button, Chip, CircularProgress, Divider, Drawer, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import { AddContactMethodForm } from '../contacts/AddContactMethodForm';
import { ContactDrawer } from '../contacts/ContactDrawer';
import { ACTIVE_REQUIRES_PARA_MESSAGE, isActiveRequiresParaError } from '../contacts/contactMethodForm';
import { contactTitle } from '../contacts/contactDisplay';
import { getContactDirectoryCompany, type DirectoryCompanyDetail, type DirectoryContactMethod, type PaymentRecipientType } from '../services/contactDirectory';
import { editContactMethod, type EditContactMethodInput } from '../services/contactMethods';

type RecipientChoice = 'NONE' | PaymentRecipientType;
const choices: Array<{ value: RecipientChoice; label: string }> = [
  { value: 'NONE', label: 'No recibe' },
  { value: 'PARA', label: 'PARA' },
  { value: 'CC', label: 'CC' },
  { value: 'CCO', label: 'CCO' }
];

// What the backend has persisted for a method (never a local guess).
function currentChoice(method: DirectoryContactMethod): RecipientChoice {
  return method.receivesPaymentNotifications ? method.paymentRecipientType ?? 'NONE' : 'NONE';
}

// Contextual recipients panel for ONE company (the provider being viewed). It reuses the existing contact
// building blocks: ContactDrawer with the company fixed (no autocomplete), AddContactMethodForm for new emails and
// the existing editContactMethod service, which persists PARA/CC/CCO as receivesPaymentNotifications +
// paymentRecipientType. It never predicts the backend rule "active notifications need a PARA": a 409 is translated
// with the existing message and the list is reloaded so the UI always shows persisted state.
// onChanged fires after every successful mutation so the owner can re-query payment-notification-settings.
export function PaymentRecipientsDrawer({ companyId, open, onClose, onChanged }: { companyId: string; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<DirectoryCompanyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setDetail(await getContactDirectoryCompany(companyId));
  }, [companyId]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true); setLoadError(false); setActionError(null); setAddingFor(null);
    getContactDirectoryCompany(companyId)
      .then((result) => { if (active) setDetail(result); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, companyId, retry]);

  // Stable identity: ContactDrawer resets its company whenever this object changes.
  const fixedCompany = useMemo(() => (detail ? { id: detail.company.id, commercialName: detail.company.commercialName } : null), [detail?.company.id, detail?.company.commercialName]); // eslint-disable-line react-hooks/exhaustive-deps

  async function afterMutation() {
    try { await reload(); } catch { setActionError('El cambio se guardó, pero no fue posible actualizar la lista. Cierra y vuelve a abrir el panel.'); }
    onChanged();
  }

  async function change(method: DirectoryContactMethod, next: RecipientChoice) {
    if (pendingRef.current.has(method.id) || next === currentChoice(method)) return;
    const input: EditContactMethodInput = next === 'NONE' ? { receivesPaymentNotifications: false } : { receivesPaymentNotifications: true, paymentRecipientType: next };
    pendingRef.current.add(method.id); setPendingIds(new Set(pendingRef.current)); setActionError(null);
    try {
      await editContactMethod(method.id, input);
      await afterMutation();
    } catch (error) {
      setActionError(isActiveRequiresParaError(error) ? ACTIVE_REQUIRES_PARA_MESSAGE : 'No fue posible actualizar el destinatario. Inténtalo nuevamente.');
      // Nothing was changed: reload so the list reflects persisted state, not what was clicked.
      void reload().catch(() => undefined);
    } finally {
      pendingRef.current.delete(method.id); setPendingIds(new Set(pendingRef.current));
    }
  }

  const contacts = detail?.contacts ?? [];

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, maxWidth: '100%' }, role: 'dialog', 'aria-label': 'Destinatarios de notificaciones de pago' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2.5 }}>
            <Box><Typography variant="h2">Destinatarios de pago</Typography>{detail && <Typography variant="body2" color="text.secondary">{detail.company.commercialName}</Typography>}</Box>
            <IconButton aria-label="Cerrar" onClick={onClose}><Close /></IconButton>
          </Stack>
          <Divider />
          <Stack spacing={2.5} sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
            <Typography variant="body2" color="text.secondary">Elige qué correos activos reciben las notificaciones de pago y con qué tipo (PARA, CC o CCO). Los cambios se guardan al elegir cada opción.</Typography>
            {actionError && <Alert severity="error">{actionError}</Alert>}
            {loading && <Box role="status" sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} aria-label="Cargando contactos" /></Box>}
            {!loading && loadError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>}>No fue posible cargar los contactos de esta empresa.</Alert>}
            {!loading && !loadError && detail && (
              <>
                {contacts.length === 0 && <Typography color="text.secondary">Este proveedor aún no tiene contactos activos. Agrega uno para poder elegir destinatarios.</Typography>}
                {contacts.map((contact) => {
                  const emails = contact.methods.filter((method) => method.type === 'CORREO');
                  const label = contactTitle(contact);
                  return (
                    <Box key={contact.id} component="section" aria-label={`Contacto ${label}`} sx={{ borderLeft: 3, borderColor: 'primary.main', pl: 2 }}>
                      <Typography fontWeight={700}>{label}</Typography>
                      <Stack spacing={1.25} sx={{ mt: 1 }}>
                        {emails.length === 0 && <Typography variant="body2" color="text.secondary">Sin correos activos.</Typography>}
                        {emails.map((method) => {
                          const choice = currentChoice(method);
                          return (
                            <Stack key={method.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
                              <Box sx={{ minWidth: 0 }}>
                                <Typography id={`recipient-email-${method.id}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>{method.value}</Typography>
                                <Chip size="small" variant="outlined" color={choice === 'NONE' ? 'default' : 'primary'} label={choice === 'NONE' ? 'Notificaciones de pago: no recibe' : `Notificaciones de pago: ${choice}`} sx={{ mt: 0.5 }} />
                              </Box>
                              <FormControl size="small" disabled={pendingIds.has(method.id)} sx={{ width: { xs: '100%', sm: 150 }, flexShrink: 0 }}>
                                <InputLabel id={`recipient-${method.id}-label`}>Tipo de destinatario</InputLabel>
                                <Select labelId={`recipient-${method.id}-label`} label="Tipo de destinatario" value={choice} SelectDisplayProps={{ 'aria-labelledby': `recipient-email-${method.id} recipient-${method.id}-label` } as HTMLAttributes<HTMLDivElement>} onChange={(event) => void change(method, event.target.value as RecipientChoice)}>
                                  {choices.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </Select>
                              </FormControl>
                            </Stack>
                          );
                        })}
                      </Stack>
                      {addingFor === contact.id
                        ? <AddContactMethodForm key={`add-${contact.id}`} contact={{ id: contact.id, label }} onClose={() => setAddingFor((current) => current === contact.id ? null : current)} onAdded={() => { setAddingFor(null); void afterMutation(); }} />
                        : <Button size="small" variant="text" startIcon={<Add />} aria-label={`Agregar correo para ${label}`} onClick={() => setAddingFor(contact.id)} sx={{ mt: 0.5, px: 0.5 }}>Agregar correo</Button>}
                    </Box>
                  );
                })}
                <Box>
                  <Button variant="outlined" startIcon={<Add />} onClick={() => setContactDrawerOpen(true)}>Agregar contacto</Button>
                  <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.75 }}>Al crear un contacto nuevo, elige después el tipo de destinatario de su correo en esta lista.</Typography>
                </Box>
              </>
            )}
          </Stack>
          <Divider />
          <Stack direction="row" justifyContent="flex-end" sx={{ p: 2.5 }}><Button onClick={onClose}>Cerrar</Button></Stack>
        </Box>
      </Drawer>
      {/* Company fixed to this provider: no autocomplete, the contact can only be created here. */}
      <ContactDrawer company={fixedCompany} open={contactDrawerOpen && fixedCompany !== null} onClose={() => setContactDrawerOpen(false)} onCreated={() => void afterMutation()} />
    </>
  );
}

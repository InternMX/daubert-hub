import { MoreVert } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, Menu, MenuItem, Typography } from '@mui/material';
import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { ContactMethodType, DirectoryContactMethod } from '../services/contactDirectory';
import type { EditedContactMethod } from '../services/contactMethods';
import { isWebUrl } from './contactMethodForm';
import { EditContactMethodForm, type EditableDirectoryContactMethod } from './EditContactMethodForm';

const methodLabels: Record<ContactMethodType, string> = { CORREO: 'Correo', TELEFONO: 'Teléfono', WHATSAPP: 'WhatsApp', WEB: 'Portal / página web', OTRO: 'Otro' };

function MethodValue({ method }: { method: DirectoryContactMethod }) {
  if (method.type === 'WEB' && isWebUrl(method.value)) return <Link href={method.value} target="_blank" rel="noopener noreferrer" variant="body2" underline="always" sx={{ color: 'text.primary', overflowWrap: 'anywhere', '&:hover': { color: 'primary.main' } }}>{method.value}</Link>;
  return <Typography component="span" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{method.value}</Typography>;
}

// Compact, text-only badges: "Principal" (es_principal) and the payment recipient type are shown
// independently; only email methods can carry either.
function MethodBadges({ method }: { method: DirectoryContactMethod }) {
  if (method.type !== 'CORREO') return null;
  const recipient = method.receivesPaymentNotifications ? method.paymentRecipientType ?? null : null;
  if (!method.isPrimary && !recipient) return null;
  return <Box component="span" sx={{ display: 'inline-flex', gap: 0.5, ml: 0.75, verticalAlign: 'middle' }}>{method.isPrimary && <Chip size="small" variant="outlined" label="Correo principal" />}{recipient && <Chip size="small" color="primary" variant="outlined" label={`Pago: ${recipient}`} />}</Box>;
}

export function ContactMethodRow({ method, inactive = false, pending, editing = false, readOnly = false, onEdit, onEditClose, onEdited, onDeactivate, onReactivate }: { method: DirectoryContactMethod; inactive?: boolean; pending: boolean; editing?: boolean; readOnly?: boolean; onEdit?: (method: DirectoryContactMethod) => void; onEditClose?: () => void; onEdited?: (method: EditedContactMethod) => void; onDeactivate?: (id: string) => Promise<boolean>; onReactivate?: (id: string) => Promise<boolean> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const label = `${methodLabels[method.type]}: ${method.value}`;
  function openMenu(event: MouseEvent<HTMLElement>) { setAnchor(event.currentTarget); }
  function chooseDeactivate() { setAnchor(null); setConfirmOpen(true); }
  function chooseEdit() { setAnchor(null); onEdit?.(method); }
  async function deactivate() { if (!onDeactivate || pending) return; if (await onDeactivate(method.id)) setConfirmOpen(false); }
  async function reactivate() { setAnchor(null); if (!onReactivate || pending) return; await onReactivate(method.id); }
  if (editing && method.type !== 'OTRO' && onEditClose && onEdited) return <EditContactMethodForm method={method as EditableDirectoryContactMethod} onClose={onEditClose} onEdited={onEdited} />;
  if (readOnly) return <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32, color: inactive ? 'text.secondary' : 'text.primary' }}><Box sx={{ minWidth: 0, flex: 1 }}><Typography component="span" variant="body2" color="text.secondary">{methodLabels[method.type]}:</Typography> <MethodValue method={method} /><MethodBadges method={method} /></Box></Box>;
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32, color: inactive ? 'text.secondary' : 'text.primary' }}>
      <Box sx={{ minWidth: 0, flex: 1 }}><Typography component="span" variant="body2" color="text.secondary">{methodLabels[method.type]}:</Typography> <MethodValue method={method} /><MethodBadges method={method} /></Box>
      <IconButton size="small" aria-label={`Acciones para ${label}`} onClick={openMenu} disabled={pending}>{pending ? <CircularProgress size={18} /> : <MoreVert fontSize="small" />}</IconButton>
    </Box>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {method.type !== 'OTRO' && onEdit && <MenuItem onClick={chooseEdit}>Editar</MenuItem>}
      {inactive ? <MenuItem onClick={reactivate} disabled={pending}>Reactivar</MenuItem> : <MenuItem onClick={chooseDeactivate}>Desactivar</MenuItem>}
    </Menu>
    {!inactive && <Dialog open={confirmOpen} onClose={() => !pending && setConfirmOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Desactivar medio de contacto</DialogTitle>
      <DialogContent><Typography>Este medio dejará de aparecer como activo para este contacto. Podrás reactivarlo posteriormente.</Typography><Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}><Typography variant="body2" fontWeight={700}>{label}</Typography></Box></DialogContent>
      <DialogActions><Button onClick={() => setConfirmOpen(false)} disabled={pending}>Cancelar</Button><Button onClick={deactivate} disabled={pending} variant="contained">Desactivar</Button></DialogActions>
    </Dialog>}
  </>;
}

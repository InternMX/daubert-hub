import { MoreVert } from '@mui/icons-material';
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Typography } from '@mui/material';
import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { ContactMethodType, DirectoryContactMethod } from '../services/contactDirectory';

const methodLabels: Record<ContactMethodType, string> = { CORREO: 'Correo', TELEFONO: 'Teléfono', WHATSAPP: 'WhatsApp', OTRO: 'Otro' };

export function ContactMethodRow({ method, inactive = false, pending, onDeactivate, onReactivate }: { method: DirectoryContactMethod; inactive?: boolean; pending: boolean; onDeactivate?: (id: string) => Promise<boolean>; onReactivate?: (id: string) => Promise<boolean> }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const label = `${methodLabels[method.type]}: ${method.value}`;
  function openMenu(event: MouseEvent<HTMLElement>) { setAnchor(event.currentTarget); }
  function chooseDeactivate() { setAnchor(null); setConfirmOpen(true); }
  async function deactivate() { if (!onDeactivate || pending) return; if (await onDeactivate(method.id)) setConfirmOpen(false); }
  async function reactivate() { setAnchor(null); if (!onReactivate || pending) return; await onReactivate(method.id); }
  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32, color: inactive ? 'text.secondary' : 'text.primary' }}>
      <Box sx={{ minWidth: 0, flex: 1 }}><Typography component="span" variant="body2" color="text.secondary">{methodLabels[method.type]}:</Typography> <Typography component="span" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{method.value}</Typography></Box>
      <IconButton size="small" aria-label={`Acciones para ${label}`} onClick={openMenu} disabled={pending}>{pending ? <CircularProgress size={18} /> : <MoreVert fontSize="small" />}</IconButton>
    </Box>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {inactive ? <MenuItem onClick={reactivate} disabled={pending}>Reactivar</MenuItem> : <MenuItem onClick={chooseDeactivate}>Desactivar</MenuItem>}
    </Menu>
    {!inactive && <Dialog open={confirmOpen} onClose={() => !pending && setConfirmOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Desactivar medio de contacto</DialogTitle>
      <DialogContent><Typography>Este medio dejará de aparecer como activo para este contacto. Podrás reactivarlo posteriormente.</Typography><Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}><Typography variant="body2" fontWeight={700}>{label}</Typography></Box></DialogContent>
      <DialogActions><Button onClick={() => setConfirmOpen(false)} disabled={pending}>Cancelar</Button><Button onClick={deactivate} disabled={pending} variant="contained">Desactivar</Button></DialogActions>
    </Dialog>}
  </>;
}

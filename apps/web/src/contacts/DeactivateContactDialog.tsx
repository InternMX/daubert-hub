import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

export function DeactivateContactDialog({ open, label, companyName, submitting, onCancel, onConfirm }: { open: boolean; label: string; companyName: string; submitting: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog open={open} onClose={() => !submitting && onCancel()} maxWidth="xs" fullWidth>
    <DialogTitle>Desactivar contacto</DialogTitle>
    <DialogContent><Typography>{label} dejará de aparecer entre los contactos activos de {companyName}. Sus medios de contacto se conservarán y podrás reactivar el contacto posteriormente.</Typography></DialogContent>
    <DialogActions><Button onClick={onCancel} disabled={submitting}>Cancelar</Button><Button onClick={onConfirm} disabled={submitting} variant="contained">Desactivar</Button></DialogActions>
  </Dialog>;
}

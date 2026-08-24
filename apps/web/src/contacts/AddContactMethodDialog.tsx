import { Close } from '@mui/icons-material';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ContactApiError } from '../services/contacts';
import { addContactMethod, type AddContactMethodType, type AddedContactMethod } from '../services/contactMethods';

const methodTypes: Array<{ value: AddContactMethodType; label: string }> = [{ value: 'CORREO', label: 'Correo' }, { value: 'TELEFONO', label: 'Teléfono' }, { value: 'WHATSAPP', label: 'WhatsApp' }];
const phonePattern = /^(?=.*\d)[+\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i;
function placeholder(type: AddContactMethodType): string { return type === 'CORREO' ? 'correo@empresa.com' : '+52 449 123 4567'; }

export function AddContactMethodDialog({ contact, onClose, onAdded }: { contact: { id: string; label: string } | null; onClose: () => void; onAdded: (contactId: string, method: AddedContactMethod) => void }) {
  const [type, setType] = useState<AddContactMethodType>('CORREO');
  const [value, setValue] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  function reset() { setType('CORREO'); setValue(''); setValueError(null); setSubmitError(null); }
  function close() { if (submittingRef.current) return; reset(); onClose(); }
  function changeType(next: AddContactMethodType) { setType(next); setValue(''); setValueError(null); setSubmitError(null); }
  function validationError(trimmed: string): string | null {
    if (!trimmed) return 'Ingresa un valor.';
    if (type === 'CORREO' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 320)) return 'Ingresa un correo válido.';
    if (type !== 'CORREO' && (trimmed.length > 100 || !phonePattern.test(trimmed))) return 'Ingresa un número de contacto válido.';
    return null;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!contact || submittingRef.current) return;
    const trimmed = value.trim(); const error = validationError(trimmed); setValueError(error); setSubmitError(null); if (error) return;
    submittingRef.current = true; setSubmitting(true);
    try { const method = await addContactMethod(contact.id, { type, value: trimmed }); const contactId = contact.id; reset(); onClose(); onAdded(contactId, method); }
    catch (error) { if (error instanceof ContactApiError && error.code === 'CONTACT_METHOD_DUPLICATE') setSubmitError('Este medio ya existe para este contacto.'); else setSubmitError('No fue posible agregar el medio de contacto. Inténtalo nuevamente.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  return <Dialog open={Boolean(contact)} onClose={close} maxWidth="xs" fullWidth PaperProps={{ component: 'form', noValidate: true, onSubmit: submit }}>
    <DialogTitle sx={{ pr: 6 }}>Agregar medio de contacto<IconButton aria-label="Cerrar" onClick={close} disabled={submitting} sx={{ position: 'absolute', right: 12, top: 12 }}><Close /></IconButton></DialogTitle>
    <DialogContent><Stack spacing={2.25} sx={{ pt: 0.5 }}><Typography variant="body2" color="text.secondary">{contact?.label}</Typography>{submitError && <Alert severity="error">{submitError}</Alert>}<FormControl fullWidth disabled={submitting}><InputLabel id="add-method-type-label">Tipo</InputLabel><Select labelId="add-method-type-label" label="Tipo" value={type} onChange={(event) => changeType(event.target.value as AddContactMethodType)}>{methodTypes.map((methodType) => <MenuItem key={methodType.value} value={methodType.value}>{methodType.label}</MenuItem>)}</Select></FormControl><TextField label="Valor" value={value} placeholder={placeholder(type)} onChange={(event) => setValue(event.target.value)} error={Boolean(valueError)} helperText={valueError} disabled={submitting} autoFocus fullWidth /></Stack></DialogContent>
    <DialogActions><Button type="button" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>Agregar</Button></DialogActions>
  </Dialog>;
}

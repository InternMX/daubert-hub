import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ContactApiError } from '../services/contacts';
import { addContactMethod, type AddContactMethodType, type AddedContactMethod } from '../services/contactMethods';
import { contactMethodValidationError, methodPlaceholder, methodTypes, methodValueLabel } from './contactMethodForm';

export function AddContactMethodForm({ contact, onClose, onAdded }: { contact: { id: string; label: string }; onClose: () => void; onAdded: (contactId: string, method: AddedContactMethod) => void }) {
  const [type, setType] = useState<AddContactMethodType>('CORREO');
  const [value, setValue] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  function reset() { setType('CORREO'); setValue(''); setValueError(null); setSubmitError(null); }
  function close() { if (submittingRef.current) return; reset(); onClose(); }
  function changeType(next: AddContactMethodType) { setType(next); setValue(''); setValueError(null); setSubmitError(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current) return;
    const trimmed = value.trim(); const error = contactMethodValidationError(type, trimmed); setValueError(error); setSubmitError(null); if (error) return;
    submittingRef.current = true; setSubmitting(true);
    try { const method = await addContactMethod(contact.id, { type, value: trimmed }); reset(); onClose(); onAdded(contact.id, method); }
    catch (error) { if (error instanceof ContactApiError && error.code === 'CONTACT_METHOD_DUPLICATE') setSubmitError('Este medio ya existe para este contacto.'); else setSubmitError('No fue posible agregar el medio de contacto. Inténtalo nuevamente.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  return <Box component="form" aria-label={`Agregar medio para ${contact.label}`} noValidate onSubmit={submit} sx={{ mt: 0.75, mb: 0.5, px: { xs: 1, sm: 1.5 }, py: 1.25, bgcolor: 'action.hover', borderRadius: 1 }}>
    <Typography variant="body2" fontWeight={700} sx={{ mb: 1.25 }}>Agregar medio</Typography>
    {submitError && <Alert severity="error" sx={{ mb: 1.25 }}>{submitError}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'flex-start' }}>
      <FormControl size="small" disabled={submitting} sx={{ width: { xs: '100%', sm: 150 }, flexShrink: 0 }}><InputLabel id={`add-method-type-${contact.id}`}>Tipo</InputLabel><Select labelId={`add-method-type-${contact.id}`} label="Tipo" value={type} onChange={(event) => changeType(event.target.value as AddContactMethodType)}>{methodTypes.map((methodType) => <MenuItem key={methodType.value} value={methodType.value}>{methodType.label}</MenuItem>)}</Select></FormControl>
      <TextField label={methodValueLabel(type)} type={type === 'WEB' ? 'url' : 'text'} value={value} placeholder={methodPlaceholder(type)} onChange={(event) => setValue(event.target.value)} error={Boolean(valueError)} helperText={valueError} disabled={submitting} size="small" autoFocus fullWidth />
    </Stack>
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}><Button type="button" size="small" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" size="small" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : undefined}>Agregar</Button></Stack>
  </Box>;
}

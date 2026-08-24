import { Alert, Box, Button, CircularProgress, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DirectoryContactMethod } from '../services/contactDirectory';
import { ContactApiError } from '../services/contacts';
import { editContactMethod, type AddContactMethodType, type EditedContactMethod, type EditContactMethodInput } from '../services/contactMethods';
import { contactMethodValidationError, methodPlaceholder, methodTypes } from './contactMethodForm';

export type EditableDirectoryContactMethod = DirectoryContactMethod & { type: AddContactMethodType };

export function EditContactMethodForm({ method, onClose, onEdited }: { method: EditableDirectoryContactMethod; onClose: () => void; onEdited: (method: EditedContactMethod) => void }) {
  const [type, setType] = useState<AddContactMethodType>(method.type);
  const [value, setValue] = useState(method.value);
  const [valueError, setValueError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const trimmed = value.trim();
  const typeChanged = type !== method.type;
  const valueChanged = trimmed !== method.value.trim();
  const dirty = typeChanged || valueChanged;
  function close() { if (!submittingRef.current) onClose(); }
  function changeType(next: AddContactMethodType) { setType(next); setValueError(null); setSubmitError(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current || !dirty) return;
    const error = contactMethodValidationError(type, trimmed); setValueError(error); setSubmitError(null); if (error) return;
    const input: EditContactMethodInput = {};
    if (typeChanged) input.type = type;
    if (valueChanged) input.value = trimmed;
    submittingRef.current = true; setSubmitting(true);
    try { const edited = await editContactMethod(method.id, input); onClose(); onEdited(edited); }
    catch (error) { if (error instanceof ContactApiError && error.code === 'CONTACT_METHOD_DUPLICATE') setSubmitError('Este medio ya existe para este contacto.'); else setSubmitError('No fue posible actualizar el medio de contacto. Inténtalo nuevamente.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  return <Box component="form" aria-label={`Editar medio ${method.value}`} noValidate onSubmit={submit} sx={{ my: 0.5, px: { xs: 1, sm: 1.5 }, py: 1.25, bgcolor: 'action.hover', borderRadius: 1 }}>
    <Typography variant="body2" fontWeight={700} sx={{ mb: 1.25 }}>Editar medio</Typography>
    {submitError && <Alert severity="error" sx={{ mb: 1.25 }}>{submitError}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems={{ sm: 'flex-start' }}>
      <FormControl size="small" disabled={submitting} sx={{ width: { xs: '100%', sm: 150 }, flexShrink: 0 }}><InputLabel id={`edit-method-type-${method.id}`}>Tipo</InputLabel><Select labelId={`edit-method-type-${method.id}`} label="Tipo" value={type} onChange={(event) => changeType(event.target.value as AddContactMethodType)}>{methodTypes.map((methodType) => <MenuItem key={methodType.value} value={methodType.value}>{methodType.label}</MenuItem>)}</Select></FormControl>
      <TextField label="Valor" value={value} placeholder={methodPlaceholder(type)} onChange={(event) => { setValue(event.target.value); setValueError(null); setSubmitError(null); }} error={Boolean(valueError)} helperText={valueError} disabled={submitting} size="small" autoFocus fullWidth />
    </Stack>
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}><Button type="button" size="small" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" size="small" variant="contained" disabled={submitting || !dirty} startIcon={submitting ? <CircularProgress size={14} color="inherit" /> : undefined}>Guardar</Button></Stack>
  </Box>;
}

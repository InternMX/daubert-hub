import { Close } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Divider, Drawer, IconButton, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DirectoryContact } from '../services/contactDirectory';
import { ContactApiError, updateContact, type UpdatedContact, type UpdateContactInput } from '../services/contacts';

const typeLabels: Record<DirectoryContact['contactType'], string> = { PERSONA: 'Persona', AREA: 'Área o departamento', BUZON_GENERICO: 'Buzón genérico' };
const optional = (value: string): string | null => value.trim() || null;

export function ContactEditDrawer({ company, contact, onClose, onUpdated }: { company: { id: string; commercialName: string } | null; contact: DirectoryContact | null; onClose: () => void; onUpdated: (contact: UpdatedContact) => void }) {
  const [name, setName] = useState(''); const [area, setArea] = useState(''); const [position, setPosition] = useState(''); const [notes, setNotes] = useState('');
  const [nameError, setNameError] = useState<string | null>(null); const [areaError, setAreaError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false); const submittingRef = useRef(false);
  useEffect(() => { if (!contact) return; setName(contact.name ?? ''); setArea(contact.area ?? ''); setPosition(contact.position ?? ''); setNotes(contact.notes ?? ''); setNameError(null); setAreaError(null); setSubmitError(null); submittingRef.current = false; setSubmitting(false); }, [contact]);
  if (!contact || !company) return null;
  const contactId = contact.id;
  const person = contact.contactType === 'PERSONA';
  const values = { name: optional(name), area: optional(area), position: optional(position), notes: optional(notes) };
  const changes: UpdateContactInput = {};
  if (person && values.name !== contact.name) changes.name = values.name;
  if (values.area !== contact.area) changes.area = values.area;
  if (person && values.position !== contact.position) changes.position = values.position;
  if (values.notes !== contact.notes) changes.notes = values.notes;
  const dirty = Object.keys(changes).length > 0;
  function close() { if (!submittingRef.current) onClose(); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current || !dirty) return; setNameError(null); setAreaError(null); setSubmitError(null);
    if (person && !values.name) { setNameError('Ingresa el nombre del contacto.'); return; }
    if (!person && !values.area) { setAreaError('Ingresa el área o departamento.'); return; }
    submittingRef.current = true; setSubmitting(true);
    try { const result = await updateContact(contactId, changes); onUpdated(result.contact); }
    catch (error) { if (error instanceof ContactApiError && error.code === 'PERSON_NAME_REQUIRED') setNameError('Ingresa el nombre del contacto.'); else if (error instanceof ContactApiError && error.code === 'CONTACT_AREA_REQUIRED') setAreaError('Ingresa el área o departamento.'); else setSubmitError('No fue posible actualizar el contacto. Inténtalo nuevamente.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  return <Drawer anchor="right" open onClose={close} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, maxWidth: '100%' } }}><Box component="form" noValidate onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2.5 }}><Typography variant="h2">Editar contacto</Typography><IconButton aria-label="Cerrar edición" onClick={close} disabled={submitting}><Close /></IconButton></Stack><Divider />
    <Stack spacing={2.5} sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
      <Box sx={{ bgcolor: 'action.hover', px: 2, py: 1.5, borderRadius: 1 }}><Typography variant="overline" color="text.secondary">Empresa</Typography><Typography fontWeight={700}>{company.commercialName}</Typography></Box>
      <Box sx={{ bgcolor: 'action.hover', px: 2, py: 1.5, borderRadius: 1 }}><Typography variant="overline" color="text.secondary">Tipo de contacto</Typography><Typography fontWeight={700}>{typeLabels[contact.contactType]}</Typography></Box>
      {submitError && <Alert severity="error">{submitError}</Alert>}
      {person && <TextField label="Nombre" required value={name} onChange={(event) => setName(event.target.value)} error={Boolean(nameError)} helperText={nameError} disabled={submitting} fullWidth autoFocus />}
      <TextField label={contact.contactType === 'AREA' ? 'Área o departamento' : 'Área'} required={!person} value={area} onChange={(event) => setArea(event.target.value)} error={Boolean(areaError)} helperText={areaError} disabled={submitting} fullWidth autoFocus={!person} />
      {person && <TextField label="Cargo" value={position} onChange={(event) => setPosition(event.target.value)} disabled={submitting} fullWidth />}
      <TextField label="Observaciones" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={submitting} multiline minRows={3} fullWidth />
    </Stack><Divider /><Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ p: 2.5 }}><Button type="button" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" variant="contained" disabled={submitting || !dirty} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>Guardar cambios</Button></Stack>
  </Box></Drawer>;
}

import { Add, Close, DeleteOutline } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Divider, Drawer, FormControl, FormHelperText, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createContact, type CreateContactInput, type CreateContactMethodType, type CreateContactType } from '../services/contacts';

type MethodRow = { id: number; type: CreateContactMethodType; value: string };
type Errors = { name?: string; area?: string; methods: Record<number, string> };

const contactTypes: Array<{ value: CreateContactType; label: string }> = [
  { value: 'PERSONA', label: 'Persona' },
  { value: 'AREA', label: 'Área o departamento' },
  { value: 'BUZON_GENERICO', label: 'Buzón genérico' }
];
const methodTypes: Array<{ value: CreateContactMethodType; label: string }> = [
  { value: 'CORREO', label: 'Correo' },
  { value: 'TELEFONO', label: 'Teléfono' },
  { value: 'WHATSAPP', label: 'WhatsApp' }
];

function placeholder(type: CreateContactMethodType): string {
  return type === 'CORREO' ? 'correo@empresa.com' : '+52 449 123 4567';
}

export function ContactDrawer({ company, open, onClose, onCreated }: { company: { id: string; commercialName: string } | null; open: boolean; onClose: () => void; onCreated: () => void }) {
  const nextMethodId = useRef(2);
  const [contactType, setContactType] = useState<CreateContactType>('PERSONA');
  const [name, setName] = useState(''); const [area, setArea] = useState(''); const [position, setPosition] = useState(''); const [notes, setNotes] = useState('');
  const [methods, setMethods] = useState<MethodRow[]>([{ id: 1, type: 'CORREO', value: '' }]);
  const [errors, setErrors] = useState<Errors>({ methods: {} }); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false);

  function reset() { setContactType('PERSONA'); setName(''); setArea(''); setPosition(''); setNotes(''); setMethods([{ id: 1, type: 'CORREO', value: '' }]); nextMethodId.current = 2; setErrors({ methods: {} }); setSubmitError(null); }
  function close() { if (submitting) return; reset(); onClose(); }
  function changeContactType(type: CreateContactType) { setContactType(type); if (type !== 'PERSONA') { setName(''); setPosition(''); } setErrors({ methods: {} }); }
  function updateMethod(id: number, patch: Partial<MethodRow>) { setMethods((current) => current.map((method) => method.id === id ? { ...method, ...patch } : method)); }
  function validate(): Errors {
    const next: Errors = { methods: {} };
    if (contactType === 'PERSONA' && !name.trim()) next.name = 'Ingresa el nombre del contacto.';
    if (contactType !== 'PERSONA' && !area.trim()) next.area = 'Ingresa el área o departamento.';
    const seen = new Set<string>();
    methods.forEach((method) => {
      const value = method.value.trim();
      if (!value) { next.methods[method.id] = 'Ingresa un valor.'; return; }
      if (method.type === 'CORREO' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) next.methods[method.id] = 'Ingresa un correo válido.';
      if ((method.type === 'TELEFONO' || method.type === 'WHATSAPP') && value.length > 100) next.methods[method.id] = 'El valor excede la longitud máxima permitida.';
      const key = `${method.type}\u0000${method.type === 'CORREO' ? value.toLowerCase() : value}`;
      if (seen.has(key)) next.methods[method.id] = 'Este medio ya fue agregado.';
      seen.add(key);
    });
    return next;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting || !company) return;
    const nextErrors = validate(); setErrors(nextErrors); setSubmitError(null);
    if (nextErrors.name || nextErrors.area || Object.keys(nextErrors.methods).length) return;
    const input: CreateContactInput = { companyId: company.id, contactType, name: contactType === 'PERSONA' ? name.trim() : null, area: area.trim() || null, position: contactType === 'PERSONA' ? position.trim() || null : null, notes: notes.trim() || null, methods: methods.map((method) => ({ type: method.type, value: method.value.trim() })) };
    setSubmitting(true);
    try { await createContact(input); reset(); onCreated(); onClose(); } catch { setSubmitError('No fue posible registrar el contacto. Inténtalo nuevamente.'); } finally { setSubmitting(false); }
  }

  return <Drawer anchor="right" open={open} onClose={close} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, maxWidth: '100%' } }}>
    <Box component="form" noValidate onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2.5 }}><Typography variant="h2">Agregar contacto</Typography><IconButton aria-label="Cerrar" onClick={close} disabled={submitting}><Close /></IconButton></Stack>
      <Divider />
      <Stack spacing={2.5} sx={{ p: 3, overflowY: 'auto', flex: 1 }}>
        <Box sx={{ bgcolor: 'action.hover', px: 2, py: 1.5, borderRadius: 1 }}><Typography variant="overline" color="text.secondary">Empresa</Typography><Typography fontWeight={700}>{company?.commercialName}</Typography></Box>
        {submitError && <Alert severity="error">{submitError}</Alert>}
        <FormControl fullWidth><InputLabel id="contact-type-label">Tipo de contacto</InputLabel><Select labelId="contact-type-label" label="Tipo de contacto" value={contactType} onChange={(event) => changeContactType(event.target.value as CreateContactType)} disabled={submitting}>{contactTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}</Select></FormControl>
        {contactType === 'PERSONA' && <><TextField label="Nombre" required value={name} onChange={(event) => setName(event.target.value)} error={Boolean(errors.name)} helperText={errors.name} disabled={submitting} fullWidth autoFocus /><TextField label="Área" value={area} onChange={(event) => setArea(event.target.value)} disabled={submitting} fullWidth /><TextField label="Cargo" value={position} onChange={(event) => setPosition(event.target.value)} disabled={submitting} fullWidth /></>}
        {contactType === 'AREA' && <TextField label="Área o departamento" required value={area} onChange={(event) => setArea(event.target.value)} error={Boolean(errors.area)} helperText={errors.area} disabled={submitting} fullWidth autoFocus />}
        {contactType === 'BUZON_GENERICO' && <TextField label="Área" required value={area} onChange={(event) => setArea(event.target.value)} error={Boolean(errors.area)} helperText={errors.area} disabled={submitting} fullWidth autoFocus />}
        <TextField label="Observaciones" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={submitting} multiline minRows={3} fullWidth />
        <Box><Typography variant="h2" sx={{ fontSize: '1rem', mb: 1.5 }}>Medios de contacto</Typography><Stack spacing={1.5}>{methods.map((method, index) => <Stack key={method.id} direction="row" spacing={1} alignItems="flex-start"><FormControl sx={{ minWidth: 132 }} size="small"><InputLabel id={`method-type-${method.id}`}>Tipo</InputLabel><Select labelId={`method-type-${method.id}`} label="Tipo" value={method.type} onChange={(event) => updateMethod(method.id, { type: event.target.value as CreateContactMethodType })} disabled={submitting}>{methodTypes.map((type) => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}</Select></FormControl><TextField label="Valor" aria-label={`Valor ${index + 1}`} value={method.value} placeholder={placeholder(method.type)} onChange={(event) => updateMethod(method.id, { value: event.target.value })} error={Boolean(errors.methods[method.id])} helperText={errors.methods[method.id]} disabled={submitting} size="small" fullWidth /><IconButton aria-label={`Eliminar medio ${index + 1}`} onClick={() => setMethods((current) => current.filter((row) => row.id !== method.id))} disabled={submitting || methods.length === 1}><DeleteOutline /></IconButton></Stack>)}</Stack><Button type="button" startIcon={<Add />} onClick={() => setMethods((current) => [...current, { id: nextMethodId.current++, type: 'CORREO', value: '' }])} disabled={submitting} sx={{ mt: 1 }}>Agregar medio</Button>{methods.length === 0 && <FormHelperText error>Agrega al menos un medio de contacto.</FormHelperText>}</Box>
      </Stack>
      <Divider /><Stack direction="row" justifyContent="flex-end" spacing={1.5} sx={{ p: 2.5 }}><Button type="button" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" variant="contained" disabled={submitting || methods.length === 0} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitting ? 'Guardando...' : 'Guardar contacto'}</Button></Stack>
    </Box>
  </Drawer>;
}

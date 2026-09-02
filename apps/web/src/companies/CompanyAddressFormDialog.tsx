import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, TextField } from '@mui/material';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createCompanyAddress, updateCompanyAddress, type CompanyAddress, type CompanyAddressInput, type CompanyAddressType } from '../services/companyAddresses';
import { companyAddressTypeOptions } from './companyAddressDisplay';

const emptyAddress: CompanyAddressInput = { tipoDireccion: 'OPERATIVA', calle: null, numeroExterior: null, numeroInterior: null, colonia: null, codigoPostal: null, municipio: null, estado: null, pais: 'México', direccionCompleta: null, referencias: null, esPrincipal: false, fechaInicio: null, fechaFin: null };
const textFields: Array<{ key: Exclude<keyof CompanyAddressInput, 'tipoDireccion' | 'esPrincipal'>; label: string; multiline?: boolean; type?: string }> = [
  { key: 'direccionCompleta', label: 'Dirección completa', multiline: true }, { key: 'calle', label: 'Calle' }, { key: 'numeroExterior', label: 'Número exterior' }, { key: 'numeroInterior', label: 'Número interior' },
  { key: 'colonia', label: 'Colonia' }, { key: 'codigoPostal', label: 'Código postal' }, { key: 'municipio', label: 'Municipio o alcaldía' }, { key: 'estado', label: 'Estado' }, { key: 'pais', label: 'País' },
  { key: 'referencias', label: 'Referencias', multiline: true }, { key: 'fechaInicio', label: 'Fecha de inicio', type: 'date' }, { key: 'fechaFin', label: 'Fecha de fin', type: 'date' }
];

function initialValue(address: CompanyAddress | null): CompanyAddressInput {
  if (!address) return emptyAddress;
  const { tipoDireccion, calle, numeroExterior, numeroInterior, colonia, codigoPostal, municipio, estado, pais, direccionCompleta, referencias, esPrincipal, fechaInicio, fechaFin } = address;
  return { tipoDireccion, calle, numeroExterior, numeroInterior, colonia, codigoPostal, municipio, estado, pais, direccionCompleta, referencias, esPrincipal, fechaInicio, fechaFin };
}

export function CompanyAddressFormDialog({ companyId, address, open, onClose, onSaved }: { companyId: string; address: CompanyAddress | null; open: boolean; onClose: () => void; onSaved: (address: CompanyAddress) => void }) {
  const typeLabelId = useId(); const [value, setValue] = useState<CompanyAddressInput>(emptyAddress); const [contentError, setContentError] = useState<string | null>(null); const [dateError, setDateError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false); const submittingRef = useRef(false);
  useEffect(() => { if (open) { setValue(initialValue(address)); setContentError(null); setDateError(null); setSubmitError(null); submittingRef.current = false; setSubmitting(false); } }, [address, open]);
  function close() { if (!submittingRef.current) onClose(); }
  function changeText(key: Exclude<keyof CompanyAddressInput, 'tipoDireccion' | 'esPrincipal'>, next: string) { setValue((current) => ({ ...current, [key]: next })); setContentError(null); setDateError(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submittingRef.current) return;
    const input = Object.fromEntries(Object.entries(value).map(([key, current]) => [key, typeof current === 'string' ? current.trim() || null : current])) as unknown as CompanyAddressInput; input.tipoDireccion = value.tipoDireccion;
    if (!input.direccionCompleta && !input.calle) { setContentError('Ingresa la dirección completa o la calle.'); return; }
    if (input.fechaInicio && input.fechaFin && input.fechaInicio > input.fechaFin) { setDateError('La fecha de inicio no puede ser posterior a la fecha de fin.'); return; }
    submittingRef.current = true; setSubmitting(true); setSubmitError(null);
    try { const result = address ? await updateCompanyAddress(address.id, input) : await createCompanyAddress(companyId, input); onSaved(result.address); }
    catch { setSubmitError(address ? 'No fue posible actualizar la dirección. Inténtalo nuevamente.' : 'No fue posible agregar la dirección. Inténtalo nuevamente.'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  const field = (index: number) => { const item = textFields[index]!; const contentField = item.key === 'direccionCompleta' || item.key === 'calle'; return <TextField key={item.key} label={item.label} type={item.type} value={value[item.key] ?? ''} onChange={(event) => changeText(item.key, event.target.value)} disabled={submitting} multiline={item.multiline} minRows={item.multiline ? 2 : undefined} error={(contentField && Boolean(contentError)) || (item.key === 'fechaFin' && Boolean(dateError))} helperText={item.key === 'direccionCompleta' ? contentError : item.key === 'fechaFin' ? dateError : undefined} slotProps={item.type === 'date' ? { inputLabel: { shrink: true } } : undefined} fullWidth />; };
  return <Dialog open={open} onClose={close} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { maxHeight: 'calc(100% - 32px)' } } }}><Box component="form" noValidate onSubmit={submit}>
    <DialogTitle>{address ? 'Editar dirección' : 'Agregar dirección'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {submitError && <Alert severity="error">{submitError}</Alert>}
      <FormControl required disabled={submitting} fullWidth><InputLabel id={typeLabelId}>Tipo de dirección</InputLabel><Select labelId={typeLabelId} label="Tipo de dirección" value={value.tipoDireccion} onChange={(event) => setValue((current) => ({ ...current, tipoDireccion: event.target.value as CompanyAddressType }))}>{companyAddressTypeOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl>
      {field(0)}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>{field(1)}{field(2)}{field(3)}</Stack><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>{field(4)}{field(5)}</Stack><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>{field(6)}{field(7)}{field(8)}</Stack>{field(9)}<Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>{field(10)}{field(11)}</Stack>
      <FormControlLabel control={<Checkbox checked={value.esPrincipal} onChange={(event) => setValue((current) => ({ ...current, esPrincipal: event.target.checked }))} disabled={submitting} />} label="Dirección principal" />
    </Stack></DialogContent><DialogActions><Button type="button" onClick={close} disabled={submitting}>Cancelar</Button><Button type="submit" variant="contained" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined}>{submitting ? 'Guardando...' : address ? 'Guardar cambios' : 'Agregar dirección'}</Button></DialogActions>
  </Box></Dialog>;
}

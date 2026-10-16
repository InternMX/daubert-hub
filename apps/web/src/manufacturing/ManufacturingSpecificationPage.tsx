import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton, InputAdornment, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { BIND_CODE_PATTERN, BindProductApiError, lookupBindProductByCode, type BindProductErrorKind, type BindProductLookup } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { SheetPreviewPanel } from './SheetPreviewPanel';
import {
  buildInitialForm, changedFields, COLOR_PRESET_LABELS, COLOR_PRESETS, confirmFamily, displayOrigin, FAMILY_LABELS, FIELD_LABELS, isEdited, restoreField, selectFamily, setColorConcentracion, setColorPreset,
  setComposition, setFieldValue, toPreviewData, validateSpecification,
  type ColorPreset, type DisplayOrigin, type FamilyCode, type FieldKey, type SpecificationForm, type SpecificationValidation
} from './specificationForm';

const originPresentation: Record<DisplayOrigin, { label: string; color: 'default' | 'success' | 'info' | 'warning' | 'secondary'; variant: 'filled' | 'outlined' }> = {
  BIND: { label: 'Recuperado de BIND', color: 'success', variant: 'outlined' },
  SUGERIDO: { label: 'Sugerido por el sistema', color: 'info', variant: 'outlined' },
  PENDIENTE: { label: 'Pendiente de confirmar', color: 'warning', variant: 'filled' },
  SIN_DATO: { label: 'Captura manual', color: 'default', variant: 'outlined' },
  USUARIO: { label: 'Editado por el usuario', color: 'secondary', variant: 'filled' },
  CATALOGO: { label: 'Cliente del catálogo (confirmado)', color: 'success', variant: 'outlined' },
  PROVISIONAL: { label: 'Texto libre: no vinculado al catálogo', color: 'warning', variant: 'filled' }
};

const errorMessages: Record<BindProductErrorKind, string> = {
  INVALID_CODE: 'El código no es válido: usa letras, dígitos, punto, guion o guion bajo (máximo 64 caracteres).',
  NOT_FOUND: 'No se encontró un producto con ese código en BIND.',
  MULTIPLE_MATCHES: 'BIND devolvió varios productos para ese código. No se eligió ninguno; contacta a un administrador.',
  NOT_CONFIGURED: 'La integración con BIND no está configurada.',
  RATE_LIMITED: 'BIND no está disponible o limitó temporalmente las consultas. Intenta de nuevo en unos minutos.',
  BIND_UNAVAILABLE: 'No se pudo consultar BIND en este momento.',
  TIMEOUT: 'BIND tardó demasiado en responder. Intenta de nuevo.',
  FORBIDDEN: 'No tienes permisos para consultar productos de BIND.',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
  INVALID_RESPONSE: 'La respuesta del servidor no tiene el formato esperado.',
  NETWORK: 'No se pudo comunicar con el servidor de Daubert Hub.'
};

interface TextExtra { onValue?: (value: string) => void; type?: string; placeholder?: string; helperText?: string; multiline?: boolean; minRows?: number; inputMode?: 'numeric' | 'decimal' }

function OriginChip({ origin }: { origin: DisplayOrigin }) {
  const p = originPresentation[origin];
  return <Chip size="small" label={p.label} color={p.color} variant={p.variant} data-testid="origin-chip" />;
}

interface FieldFrameProps {
  form: SpecificationForm;
  fieldKey: FieldKey;
  error?: string;
  onRestore: (key: FieldKey) => void;
  children: ReactNode;
}

// Marco común de cada campo: procedencia, nota del sistema, valor original de BIND cuando el usuario lo modificó y botón para restaurarlo.
function FieldFrame({ form, fieldKey, error, onRestore, children }: FieldFrameProps) {
  const state = form.fields[fieldKey];
  const origin = displayOrigin(state);
  const edited = isEdited(state) && state.base.origin !== 'SIN_DATO';
  return (
    <Box sx={{ minWidth: 0 }}>
      {children}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <OriginChip origin={origin} />
        {edited && (
          <>
            <Typography variant="caption" color="text.secondary">{state.base.value === '' ? 'BIND no entregó este dato.' : `Valor de BIND: ${state.base.value}`}</Typography>
            <Tooltip title="Restaurar el valor de BIND">
              <IconButton size="small" aria-label={`Restaurar ${FIELD_LABELS[fieldKey]}`} onClick={() => onRestore(fieldKey)}><RestoreRoundedIcon fontSize="inherit" /></IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
      {origin === 'PENDIENTE' && state.base.note && <Typography variant="caption" color="warning.main" display="block">{state.base.note}</Typography>}
      {error && <Typography variant="caption" color="error" display="block" role="alert">{error}</Typography>}
    </Box>
  );
}

interface ClientOption { id: string; name: string }

function ClientField({ form, error, onChange, onRestore }: { form: SpecificationForm; error?: string; onChange: (value: string, source: 'CATALOGO' | 'PROVISIONAL' | undefined, ref?: string) => void; onRestore: (key: FieldKey) => void }) {
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [input, setInput] = useState(form.fields.cliente.value);
  useEffect(() => {
    const term = input.trim();
    if (term.length < 2) { setOptions([]); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      listClients({ search: term, sortOrder: 'asc', page: 1, pageSize: 10 })
        .then((result) => { if (active) setOptions(result.data.filter((client) => client.clientStatus === 'ACTIVO').map((client) => ({ id: client.id, name: client.commercialName }))); })
        .catch(() => { if (active) setOptions([]); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [input]);
  const current = form.fields.cliente;
  return (
    <FieldFrame form={form} fieldKey="cliente" error={error} onRestore={onRestore}>
      <Autocomplete
        freeSolo
        options={options}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        filterOptions={(all) => all}
        inputValue={input}
        value={current.source === 'CATALOGO' && current.ref ? { id: current.ref, name: current.value } : current.value || null}
        onInputChange={(_event, value, reason) => {
          setInput(value);
          if (reason === 'input') onChange(value, value.trim() === '' ? undefined : 'PROVISIONAL');
          if (reason === 'clear') onChange('', undefined);
        }}
        onChange={(_event, value) => { if (value !== null && typeof value !== 'string') onChange(value.name, 'CATALOGO', value.id); }}
        renderInput={(params) => <TextField {...params} label="Cliente (obligatorio)" error={Boolean(error)} helperText="Elige un cliente del catálogo. El texto libre no cuenta como cliente vinculado. No se infiere por el prefijo del código." />}
      />
    </FieldFrame>
  );
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label={title}>
      <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>{children}</Box>
    </Paper>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

function BindProductPanel({ lookup }: { lookup: BindProductLookup }) {
  const { producto } = lookup;
  const rows: Array<[string, string]> = [
    ['ID en BIND', producto.ID], ['Código (Code)', producto.Code], ['Descripción comercial (Title)', producto.Title],
    ['Información adicional (Description)', producto.Description ?? '—'], ['Peso (Weight, lb)', producto.Weight === null ? '—' : String(producto.Weight)],
    ['Fecha de alta en BIND', formatDate(producto.CreationDate)]
  ];
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Producto en BIND">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Producto en BIND</Typography>
        <Chip size="small" label="Solo lectura" />
        <Chip size="small" color="warning" label="Especificación no confirmada" />
      </Stack>
      <Box component="dl" sx={{ m: 0, mt: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(180px, 30%) 1fr' }, columnGap: 2, rowGap: 0.75 }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>La fecha de alta es la del producto en BIND, no la fecha de emisión de la hoja. Estos datos no se modifican desde esta pantalla.</Typography>
    </Paper>
  );
}

export function ManufacturingSpecificationPage() {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorKind, setErrorKind] = useState<BindProductErrorKind | null>(null);
  const [lookup, setLookup] = useState<BindProductLookup | null>(null);
  const [form, setForm] = useState<SpecificationForm | null>(null);
  const [validation, setValidation] = useState<SpecificationValidation | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function search(): Promise<void> {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setValidation(null);
    if (!BIND_CODE_PATTERN.test(code.trim())) {
      setStatus('error'); setErrorKind('INVALID_CODE'); setLookup(null); setForm(null);
      return;
    }
    setStatus('loading'); setErrorKind(null);
    try {
      const result = await lookupBindProductByCode(code, current.signal);
      if (current.signal.aborted) return;
      setLookup(result); setForm(buildInitialForm(result)); setStatus('ready');
    } catch (error) {
      if (current.signal.aborted) return;
      setLookup(null); setForm(null); setStatus('error');
      setErrorKind(error instanceof BindProductApiError ? error.kind : 'NETWORK');
    }
  }

  const update = (updater: (previous: SpecificationForm) => SpecificationForm): void => {
    setForm((previous) => (previous ? updater(previous) : previous));
    setValidation(null);
  };
  const setValue = (key: FieldKey, value: string): void => update((f) => setFieldValue(f, key, value));
  const restore = (key: FieldKey): void => update((f) => restoreField(f, key));
  const errors = validation?.errors ?? {};

  const text = (key: FieldKey, extra: TextExtra = {}) => (
    form && (
      <FieldFrame form={form} fieldKey={key} error={errors[key]} onRestore={restore}>
        <TextField
          fullWidth label={FIELD_LABELS[key]} value={form.fields[key].value} error={Boolean(errors[key])} onChange={(e) => (extra.onValue ? extra.onValue(e.target.value) : setValue(key, e.target.value))}
          type={extra.type} placeholder={extra.placeholder} helperText={extra.helperText} multiline={extra.multiline} minRows={extra.minRows}
          slotProps={{ htmlInput: extra.inputMode ? { inputMode: extra.inputMode } : {}, inputLabel: extra.type === 'date' ? { shrink: true } : {} }}
        />
      </FieldFrame>
    )
  );
  const select = (key: FieldKey, options: Array<[string, string]>) => (
    form && (
      <FieldFrame form={form} fieldKey={key} error={errors[key]} onRestore={restore}>
        <TextField select fullWidth label={FIELD_LABELS[key]} value={form.fields[key].value} error={Boolean(errors[key])} onChange={(e) => setValue(key, e.target.value)}>
          <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
          {options.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
      </FieldFrame>
    )
  );
  const radios = (key: FieldKey, options: Array<[string, string]>, onPick?: (value: string) => void) => (
    form && (
      <FieldFrame form={form} fieldKey={key} error={errors[key]} onRestore={restore}>
        <FormControl error={Boolean(errors[key])}>
          <FormLabel id={`${key}-label`}>{FIELD_LABELS[key]}</FormLabel>
          <RadioGroup row aria-labelledby={`${key}-label`} value={form.fields[key].value} onChange={(e) => (onPick ? onPick(e.target.value) : setValue(key, e.target.value))}>
            {options.map(([value, label]) => <FormControlLabel key={value} value={value} control={<Radio />} label={label} />)}
          </RadioGroup>
        </FormControl>
      </FieldFrame>
    )
  );

  const live = form ? validateSpecification(form, lookup ?? undefined) : null;
  const colorPreset = form?.fields.colorPreset.value ?? '';
  const colorSwatch = (hex: string) => <Box aria-label="Muestra del color" role="img" data-testid="color-swatch" sx={{ width: 32, height: 32, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : 'transparent', flexShrink: 0 }} />;

  return (
    <Box sx={{ maxWidth: 1500, minWidth: 0 }}>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Hojas de manufactura' }]} />
      <PageHeader title="Especificación de manufactura" description="Busca un producto en BIND por su código DCMX, revisa y corrige los datos interpretados y selecciona la familia. Los datos solo existen en memoria: no se guardan ni se emite ninguna hoja." />

      <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }} onSubmit={(e) => { e.preventDefault(); void search(); }} aria-label="Buscar producto en BIND">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <TextField
            label="Código DCMX a buscar" value={code} onChange={(e) => setCode(e.target.value)} fullWidth autoComplete="off" placeholder="Ej. SCHFPMG001"
            helperText="Búsqueda exacta por código en BIND (solo lectura)."
            slotProps={{ htmlInput: { maxLength: 64 }, input: { endAdornment: status === 'loading' ? <InputAdornment position="end"><CircularProgress size={18} aria-label="Buscando" /></InputAdornment> : undefined } }}
          />
          <Button type="submit" variant="contained" startIcon={<SearchRoundedIcon />} disabled={status === 'loading' || code.trim() === ''} sx={{ minWidth: 190, mt: { sm: 0.5 } }}>Buscar en BIND</Button>
        </Stack>
      </Paper>

      {status === 'loading' && <Alert severity="info" sx={{ mt: 2 }}>Consultando BIND…</Alert>}
      {status === 'error' && errorKind && <Alert severity={errorKind === 'NOT_FOUND' ? 'info' : 'error'} sx={{ mt: 2 }}>{errorMessages[errorKind]}</Alert>}

      {status === 'ready' && lookup && form && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(420px, 520px)' }, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0, order: { xs: 2, lg: 1 } }}>
          <BindProductPanel lookup={lookup} />
          {lookup.advertencias.length > 0 && (
            <Stack spacing={1} sx={{ mt: 2 }} aria-label="Advertencias del producto">
              {lookup.advertencias.map((a) => <Alert key={`${a.codigo}-${a.campos.join()}`} severity={a.codigo === 'FAMILIA_NO_CONFIRMADA' ? 'info' : 'warning'}>{a.mensaje}</Alert>)}
            </Stack>
          )}

          <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Familia de manufactura">
            <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 1 }}>Familia de manufactura</Typography>
            <FormControl error={Boolean(errors.familia)}>
              <FormLabel id="family-label">{form.familyOrigin === 'SUGERIDA' ? 'Familia sugerida (provisional): confírmala o cámbiala' : 'Selecciona la familia'}</FormLabel>
              <RadioGroup row aria-labelledby="family-label" value={form.family ?? ''} onChange={(e) => update((f) => selectFamily(f, e.target.value as FamilyCode))}>
                {(Object.keys(FAMILY_LABELS) as FamilyCode[]).map((family) => <FormControlLabel key={family} value={family} control={<Radio />} label={FAMILY_LABELS[family]} />)}
              </RadioGroup>
              {errors.familia && <FormHelperText role="alert">{errors.familia}</FormHelperText>}
            </FormControl>
            {form.familyOrigin === 'SUGERIDA' && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                <Chip size="small" color="info" variant="outlined" label="Sugerida por el sistema (provisional)" data-testid="family-chip" />
                <Button size="small" onClick={() => update((f) => confirmFamily(f))}>Confirmar familia</Button>
              </Stack>
            )}
            {form.familyOrigin === 'USUARIO' && <Chip size="small" color="secondary" label="Familia elegida por el usuario" sx={{ mt: 0.5 }} data-testid="family-chip" />}
            {form.familyNote && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="family-note">{form.family ? `Motivo: ${form.familyNote}` : `Sin familia sugerida. ${form.familyNote}`}</Typography>}
          </Paper>

          <SectionCard title="Datos generales">
            {text('codigo')}
            {text('descripcion', { multiline: true, minRows: 2 })}
            {text('producto')}
            <ClientField form={form} error={errors.cliente} onRestore={restore} onChange={(value, source, ref) => update((f) => setFieldValue(f, 'cliente', value, source, ref))} />
            {text('fechaEmision', { type: 'date', helperText: 'Fecha local sugerida; editable. No es la fecha de alta en BIND ni la emisión definitiva.' })}
            {text('resinaVci', { helperText: 'Editable. Sugerencia según la composición; el porcentaje no es una obligación.' })}
          </SectionCard>

          <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Color">
            <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2 }}>Color</Typography>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
              <FieldFrame form={form} fieldKey="colorPreset" error={errors.colorPreset} onRestore={restore}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  {colorSwatch(form.fields.colorHex.value)}
                  <TextField select fullWidth label="Color" value={colorPreset} error={Boolean(errors.colorPreset)} onChange={(e) => update((f) => setColorPreset(f, e.target.value as ColorPreset | ''))}>
                    <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
                    {(Object.keys(COLOR_PRESET_LABELS) as ColorPreset[]).map((preset) => (
                      <MenuItem key={preset} value={preset}>{COLOR_PRESET_LABELS[preset]}{preset !== 'OTRO' ? ` (${COLOR_PRESETS[preset].hex})` : ''}</MenuItem>
                    ))}
                  </TextField>
                </Stack>
              </FieldFrame>
              {text('colorConcentracion', { onValue: (value) => update((f) => setColorConcentracion(f, value)), inputMode: 'decimal', helperText: 'Concentración del color. Es independiente del porcentaje de la resina VCI.' })}
              {text('colorNombre', { helperText: 'Texto impreso en el campo Color del documento (editable).' })}
              {colorPreset === 'OTRO'
                ? text('colorHex', { placeholder: '#RRGGBB', helperText: 'Color del dibujo para «Otro».' })
                : <Typography variant="body2" color="text.secondary" data-testid="color-hex-readonly">{colorPreset ? `Color del dibujo: ${form.fields.colorHex.value}` : 'Elige un color para el dibujo.'}</Typography>}
            </Box>
          </Paper>

          <SectionCard title="Composición y presentación">
            {radios('composicion', [['PMG', 'PMG'], ['CP5000', 'CP5000'], ['NAT', 'Natural']], (value) => update((f) => setComposition(f, value)))}
            {radios('presentacion', [['ROLLO', 'Rollo'], ['PAQUETE', 'Paquete']])}
            {text('cantidad', { inputMode: 'numeric' })}
            {select('cantidadUnidad', [['BOLSAS', 'Bolsas'], ['HOJAS', 'Hojas']])}
          </SectionCard>

          <SectionCard title="Medidas y peso">
            {text('ancho', { inputMode: 'decimal' })}
            {text('largo', { inputMode: 'decimal' })}
            {select('unidadDimensiones', [['IN', 'Pulgadas (IN)'], ['MM', 'Milímetros (MM)']])}
            {text('pesoLb', { inputMode: 'decimal' })}
            {text('calibre', { helperText: 'Valor literal de BIND (p. ej. 200, 2 MIL, 2.7). No se convierte ni se agrega unidad; corrígelo solo si es necesario.' })}
          </SectionCard>

          {form.family && (
            <SectionCard title={`Datos de ${FAMILY_LABELS[form.family]}`}>
              {form.family === 'HOJA_PAQ' && radios('modalidad', [['DOBLADA', 'Doblada'], ['EXTENDIDA', 'Extendida']])}
              <Box>
                {text('etiqueta', { multiline: true, minRows: 2, helperText: 'Precargada con el título completo de BIND; se edita de forma independiente a la descripción.' })}
                <Button size="small" startIcon={<RestoreRoundedIcon />} sx={{ mt: 0.5 }} onClick={() => restore('etiqueta')} disabled={form.fields.etiqueta.value === form.fields.etiqueta.base.value || form.fields.etiqueta.base.value === ''}>Restaurar título de BIND</Button>
              </Box>
            </SectionCard>
          )}

          <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Validación">
            {live && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} aria-label="Estado de la especificación">
                <Chip size="small" color={live.previewable ? 'info' : 'default'} label={live.previewable ? 'Borrador previsualizable' : 'Borrador: falta la familia'} data-testid="status-preview" />
                <Chip size="small" color={live.complete ? 'success' : 'warning'} label={live.complete ? 'Datos obligatorios completos' : `Datos obligatorios incompletos (${Object.keys(live.errors).length})`} data-testid="status-complete" />
                <Chip size="small" color={live.confirmed ? 'success' : 'default'} variant={live.confirmed ? 'filled' : 'outlined'} label={live.confirmed ? 'Confirmada por el usuario (sin guardar)' : 'No confirmada'} data-testid="status-confirmed" />
              </Stack>
            )}
            {live && live.pending.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1.5 }} data-testid="pending-list">
                <strong>Pendientes:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{live.pending.map((p) => <li key={p}>{p}</li>)}</ul>
              </Alert>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Button variant="contained" onClick={() => setValidation(validateSpecification(form, lookup))}>Validar especificación</Button>
              <Typography variant="body2" color="text.secondary">
                {changedFields(form).length === 0 ? 'Sin cambios respecto a lo recuperado de BIND.' : `Campos modificados por el usuario: ${changedFields(form).map((k) => FIELD_LABELS[k]).join(', ')}.`}
              </Typography>
            </Stack>
            {validation && (
              <Stack spacing={1} sx={{ mt: 2 }}>
                {validation.confirmed
                  ? <Alert severity="success">La especificación está completa y la familia fue confirmada. Aún no se guarda ni se emite ninguna hoja.</Alert>
                  : validation.complete
                    ? <Alert severity="info">Los datos obligatorios están completos, pero la familia sigue siendo una sugerencia: confírmala para considerar la especificación confirmada.</Alert>
                    : <Alert severity="error">Faltan datos obligatorios o hay valores no válidos ({Object.keys(validation.errors).length}). Revisa los campos marcados. El borrador sigue visible, pero la especificación no está completa.</Alert>}
                {validation.warnings.map((w) => <Alert key={w} severity="warning">{w}</Alert>)}
              </Stack>
            )}
          </Paper>
        </Box>
        <Box sx={{ minWidth: 0, order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 16 }, mt: 2 }}>
          <SheetPreviewPanel family={form.family} data={toPreviewData(form)} />
        </Box>
        </Box>
      )}
    </Box>
  );
}

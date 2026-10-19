import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton, InputAdornment, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { BIND_CODE_PATTERN, BindProductApiError, lookupBindProductByCode, type BindProductErrorKind, type BindProductLookup, type FuenteDato } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { listManufacturingFamilies, type FamilyConfig } from '../services/manufacturingFamilies';
import type { SheetPreviewResponse } from '../services/sheetPreview';
import { IncidenciasDeCampo, IncidenciasDeSeccion, IncidenciasProvider, ResumenIncidencias } from './IncidenciaViews';
import { buildIncidencias, estaReconocida, huella, type Incidencia, type Reconocimientos, type SeccionIncidencia } from './incidencias';
import { SheetPreviewPanel } from './SheetPreviewPanel';
import {
  buildInitialForm, changedFields, COLOR_OTRO, configOf, confirmFamily, displayOrigin, FIELD_LABELS, isEdited, restoreField, selectFamily, setColorConcentracion, setColorPreset, setComposition,
  setCoexVariante, setFieldValue, setFuelleTotal, suggestLayerWeights, confirmLayerWeights, toPreviewData, validateSpecification,
  type DisplayOrigin, type FamilyCode, type FieldKey, type SpecificationForm, type SpecificationValidation
} from './specificationForm';

const originPresentation: Record<DisplayOrigin, { label: string; color: 'default' | 'success' | 'info' | 'warning' | 'secondary'; variant: 'filled' | 'outlined' }> = {
  BIND: { label: 'Recuperado de BIND', color: 'success', variant: 'outlined' },
  SUGERIDO: { label: 'Sugerido por el sistema', color: 'info', variant: 'outlined' },
  CALCULADO: { label: 'Calculado por el sistema', color: 'info', variant: 'outlined' },
  PENDIENTE: { label: 'Pendiente de confirmar', color: 'warning', variant: 'outlined' },
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

const sourcePresentation: Record<FuenteDato, { label: string; color: 'default' | 'success' | 'info' | 'warning' | 'error' }> = {
  TITLE: { label: 'Extraído de Title', color: 'success' },
  CODE: { label: 'Inferido de Code', color: 'info' },
  TITLE_Y_CODE: { label: 'Corroborado por Title y Code', color: 'success' },
  CONTRADICCION: { label: 'Contradicción Title/Code', color: 'error' }
};

function SourceChip({ source }: { source: FuenteDato }) {
  const p = sourcePresentation[source];
  return <Chip size="small" label={p.label} color={p.color} variant="outlined" data-testid="source-chip" />;
}

function OriginChip({ origin }: { origin: DisplayOrigin }) {
  const p = originPresentation[origin];
  return <Chip size="small" label={p.label} color={p.color} variant={p.variant} data-testid="origin-chip" />;
}

interface FieldFrameProps {
  form: SpecificationForm;
  fieldKey: FieldKey;
  /** Marca el campo en rojo (el mensaje lo muestra la incidencia del campo). */
  error?: string;
  onRestore: (key: FieldKey) => void;
  children: ReactNode;
}

// Marco común de cada campo: procedencia, nota del sistema, valor original de BIND cuando el usuario lo modificó y botón para restaurarlo.
function FieldFrame({ form, fieldKey, onRestore, children }: FieldFrameProps) {
  const state = form.fields[fieldKey];
  const origin = displayOrigin(state);
  const edited = isEdited(state) && state.base.origin !== 'SIN_DATO';
  return (
    <Box sx={{ minWidth: 0 }} data-field={fieldKey}>
      {children}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <OriginChip origin={origin} />
        {state.base.fuente && origin !== 'USUARIO' && <SourceChip source={state.base.fuente} />}
        {edited && (
          <>
            <Typography variant="caption" color="text.secondary">{state.base.value === '' ? 'Sin valor inicial.' : `${state.base.origin === 'BIND' ? 'Valor de BIND' : 'Valor inicial sugerido'}: ${state.base.value}`}</Typography>
            <Tooltip title={state.base.origin === 'BIND' ? 'Restaurar el valor de BIND' : 'Restaurar sugerencia (en capas usa el peso total actual)'}>
              <IconButton size="small" aria-label={`Restaurar ${FIELD_LABELS[fieldKey]}`} onClick={() => onRestore(fieldKey)}><RestoreRoundedIcon fontSize="inherit" /></IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
      {origin === 'PENDIENTE' && state.base.note && <Typography variant="caption" color="warning.main" display="block">{state.base.note}</Typography>}
      {(origin === 'SUGERIDO' || origin === 'CALCULADO') && state.base.note && fieldKey !== 'fechaEmision' && <Typography variant="caption" color="text.secondary" display="block">{state.base.note}</Typography>}
      {state.confirmed && <Typography variant="caption" display="block">Peso revisado para este borrador; protegido frente al recálculo automático.</Typography>}
      <IncidenciasDeCampo campo={fieldKey} />
    </Box>
  );
}

interface ClientOption { id: string; name: string }

function ClientField({ form, onChange, onRestore }: { form: SpecificationForm; onChange: (value: string, source: 'CATALOGO' | 'PROVISIONAL' | undefined, ref?: string) => void; onRestore: (key: FieldKey) => void }) {
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
    <FieldFrame form={form} fieldKey="cliente" onRestore={onRestore}>
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
        renderInput={(params) => <TextField {...params} label="Cliente (opcional)" helperText="Elige un cliente del catálogo. Puede quedar vacío en la demostración; una emisión futura lo exigirá. No se infiere por el prefijo del código." />}
      />
    </FieldFrame>
  );
}

function SectionCard({ title, seccion, children }: { title: string; seccion?: SeccionIncidencia; children: ReactNode }) {
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label={title}>
      <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2 }}>{title}</Typography>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>{children}</Box>
      {seccion && <IncidenciasDeSeccion seccion={seccion} />}
    </Paper>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
}

const MATERIAL_LABEL: Record<string, string> = { FILM: 'Film / plástico', PAPEL: 'Papel' };

// Material y clave interpretados (del Title y/o del Code) con su procedencia; una inferencia del código nunca se muestra como dato del título.
function MaterialRow({ lookup }: { lookup: BindProductLookup }) {
  const { material, claveMaterial } = lookup.interpretacion.campos;
  if (!material && !claveMaterial) return null;
  const partes = [material?.valor ? MATERIAL_LABEL[material.valor] : null, claveMaterial?.valor ? `clave ${claveMaterial.valor}` : null].filter(Boolean);
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} data-testid="material-row">
      <Typography variant="body2" color="text.secondary">Material interpretado:</Typography>
      <Typography variant="body2">{partes.length > 0 ? partes.join(' · ') : 'sin interpretación confiable'}</Typography>
      {material?.procedencia ? <SourceChip source={material.procedencia} /> : material?.origen === 'EXTRAIDO' ? <SourceChip source="TITLE" /> : <Chip size="small" label="Pendiente" color="warning" variant="outlined" data-testid="source-chip" />}
    </Stack>
  );
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
      <MaterialRow lookup={lookup} />
      <IncidenciasDeSeccion seccion="bind" />
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>La fecha de alta es la del producto en BIND, no la fecha de emisión de la hoja. Estos datos no se modifican desde esta pantalla.</Typography>
    </Paper>
  );
}

const CANTIDAD_UNIDADES: Array<[string, string]> = [['BOLSAS', 'Bolsas'], ['HOJAS', 'Hojas']];

export function ManufacturingSpecificationPage() {
  const [configs, setConfigs] = useState<FamilyConfig[]>([]);
  const [configStatus, setConfigStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorKind, setErrorKind] = useState<BindProductErrorKind | null>(null);
  const [lookup, setLookup] = useState<BindProductLookup | null>(null);
  const [form, setForm] = useState<SpecificationForm | null>(null);
  const [validation, setValidation] = useState<SpecificationValidation | null>(null);
  const [assessment, setAssessment] = useState<{ key: string; result: SheetPreviewResponse } | null>(null);
  const [reviewedKey, setReviewedKey] = useState('');
  const [reviewWeights, setReviewWeights] = useState(false);
  const [reconocidas, setReconocidas] = useState<Reconocimientos>({});
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    listManufacturingFamilies(abort.signal).then((list) => { setConfigs(list); setConfigStatus('ready'); }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setConfigStatus('error');
    });
    return () => abort.abort();
  }, []);

  async function search(): Promise<void> {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setValidation(null);
    setReviewedKey('');
    setReviewWeights(false);
    setReconocidas({});
    if (!BIND_CODE_PATTERN.test(code.trim())) {
      setStatus('error'); setErrorKind('INVALID_CODE'); setLookup(null); setForm(null);
      return;
    }
    setStatus('loading'); setErrorKind(null);
    try {
      const result = await lookupBindProductByCode(code, current.signal);
      if (current.signal.aborted) return;
      setLookup(result); setForm(buildInitialForm(result, configs)); setStatus('ready');
    } catch (error) {
      if (current.signal.aborted) return;
      setLookup(null); setForm(null); setStatus('error');
      setErrorKind(error instanceof BindProductApiError ? error.kind : 'NETWORK');
    }
  }

  const update = (updater: (previous: SpecificationForm) => SpecificationForm): void => {
    setForm((previous) => (previous ? updater(previous) : previous));
    setValidation(null);
    setReviewedKey('');
  };
  const setValue = (key: FieldKey, value: string): void => update((f) => setFieldValue(f, key, value));
  const restore = (key: FieldKey): void => update((f) => restoreField(f, key));
  const errors = validation?.errors ?? {};

  const config = useMemo(() => (form ? configOf(configs, form.family) : null), [configs, form]);
  // Sin familia elegida se muestran los campos comunes a todas las familias; con familia, exactamente los de su configuración (la configuración manda, no hay condiciones por familia aquí).
  const common = useMemo(() => configs.reduce<FieldKey[] | null>((acc, c) => (acc === null ? c.campos : acc.filter((k) => c.campos.includes(k))), null) ?? [], [configs]);
  const has = (key: FieldKey): boolean => (config ? config.campos.includes(key) : common.includes(key));
  const unidades = config?.unidades ?? configs[0]?.unidades ?? [];

  const text = (key: FieldKey, extra: TextExtra = {}) => (
    form && has(key) && (
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
    form && has(key) && (
      <FieldFrame form={form} fieldKey={key} error={errors[key]} onRestore={restore}>
        <TextField select fullWidth label={FIELD_LABELS[key]} value={form.fields[key].value} error={Boolean(errors[key])} onChange={(e) => setValue(key, e.target.value)}>
          <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
          {options.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
      </FieldFrame>
    )
  );
  const radios = (key: FieldKey, options: Array<{ value: string; label: string; disabled?: boolean; hint?: string }>, onPick?: (value: string) => void, fixed?: string | null) => (
    form && has(key) && (
      <FieldFrame form={form} fieldKey={key} error={errors[key]} onRestore={restore}>
        <FormControl error={Boolean(errors[key])}>
          <FormLabel id={`${key}-label`}>{FIELD_LABELS[key]}{fixed ? ' (fija en esta familia)' : ''}</FormLabel>
          <RadioGroup row aria-labelledby={`${key}-label`} value={fixed ?? form.fields[key].value} onChange={(e) => (onPick ? onPick(e.target.value) : setValue(key, e.target.value))}>
            {options.map((o) => <FormControlLabel key={o.value} value={o.value} disabled={Boolean(fixed) || o.disabled} control={<Radio />} label={o.label} />)}
          </RadioGroup>
          {options.filter((o) => o.disabled && o.hint).map((o) => <FormHelperText key={o.value} data-testid={`${key}-${o.value}-blocked`}>{`${o.label}: no autorizada. ${o.hint}`}</FormHelperText>)}
        </FormControl>
      </FieldFrame>
    )
  );

  const live = form && configStatus === 'ready' ? validateSpecification(form, configs, lookup ?? undefined) : null;
  const reviewKey = JSON.stringify({ form, producto: lookup?.producto });
  const previewData = form && config ? { ...toPreviewData(form, config), ...(config.fuelles ? { fuelleTotal: form.fields.fuelleTotal.value } : {}) } : {};
  const previewContext = lookup && form ? { title: lookup.producto.Title, code: lookup.producto.Code, composicionSeleccionada: form.fields.composicion.value } : undefined;
  const assessmentKey = JSON.stringify({ family: form?.family, data: previewData, context: previewContext });
  const currentAssessment = assessment?.key === assessmentKey ? assessment.result : null;
  // UNA lista de incidencias por causa (mismo id), reunida de: validación local, coherencia del backend (solo la respuesta VIGENTE para estos datos) y advertencias de BIND.
  const valores = (key: FieldKey): string => form?.fields[key].value ?? '';
  const todas: Incidencia[] = form && lookup
    ? buildIncidencias({ locales: live?.incidencias ?? [], backend: currentAssessment?.incidencias ?? [], advertencias: lookup.advertencias, valores, config })
    : [];
  const sinReconocer = todas.filter((i) => i.nivel === 'CONTRADICCION' && !estaReconocida(i, valores, reconocidas));
  const avisosVistaPrevia = todas.filter((i) => i.afectaVistaPrevia && i.codigo !== 'FALTANTE' && !estaReconocida(i, valores, reconocidas));
  const reconocer = (i: Incidencia): void => setReconocidas((r) => ({ ...r, [i.id]: huella(i, valores) }));
  const deshacer = (i: Incidencia): void => setReconocidas((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== i.id)));
  const ctx = { lista: todas, visible: (key: FieldKey): boolean => (config ? config.campos.includes(key) : true), valores, reconocidas, reconocer, deshacer, validado: validation !== null };
  const reviewed = reviewedKey === reviewKey && Boolean(currentAssessment?.completo) && !currentAssessment?.bloqueado && Boolean(live?.technicalReady) && form?.familyOrigin === 'USUARIO' && sinReconocer.length === 0;
  const colorPreset = form?.fields.colorPreset.value ?? '';
  const colorSwatch = (hex: string) => <Box aria-label="Muestra del color" role="img" data-testid="color-swatch" sx={{ width: 32, height: 32, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : 'transparent', flexShrink: 0 }} />;
  const composiciones = (config?.composiciones ?? ['PMG', 'CP5000', 'NAT']).map((value) => ({ value, label: value === 'NAT' ? 'Natural' : value }));

  return (
    <Box sx={{ maxWidth: 1500, minWidth: 0 }}>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Hojas de manufactura' }]} />
      <PageHeader title="Especificación de manufactura" description="Busca un producto en BIND por su código DCMX, revisa y corrige los datos interpretados y selecciona la familia. Los datos solo existen en memoria: no se guardan ni se emite ninguna hoja." />

      {configStatus === 'error' && <Alert severity="error" sx={{ mt: 2 }}>No se pudo cargar la configuración de las familias de manufactura. Recarga la página.</Alert>}

      <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }} onSubmit={(e) => { e.preventDefault(); void search(); }} aria-label="Buscar producto en BIND">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <TextField
            label="Código DCMX a buscar" value={code} onChange={(e) => setCode(e.target.value)} fullWidth autoComplete="off" placeholder="Ej. SCHFPMG001"
            helperText="Búsqueda exacta por código en BIND (solo lectura)."
            slotProps={{ htmlInput: { maxLength: 64 }, input: { endAdornment: status === 'loading' ? <InputAdornment position="end"><CircularProgress size={18} aria-label="Buscando" /></InputAdornment> : undefined } }}
          />
          <Button type="submit" variant="contained" startIcon={<SearchRoundedIcon />} disabled={status === 'loading' || code.trim() === '' || configStatus !== 'ready'} sx={{ minWidth: 190, mt: { sm: 0.5 } }}>Buscar en BIND</Button>
        </Stack>
      </Paper>

      {status === 'loading' && <Alert severity="info" sx={{ mt: 2 }}>Consultando BIND…</Alert>}
      {status === 'error' && errorKind && <Alert severity={errorKind === 'NOT_FOUND' ? 'info' : 'error'} sx={{ mt: 2 }}>{errorMessages[errorKind]}</Alert>}

      {status === 'ready' && lookup && form && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(420px, 520px)' }, alignItems: 'start' }}>
        <IncidenciasProvider value={ctx}>
        <Box sx={{ minWidth: 0, order: { xs: 2, lg: 1 } }}>
          <BindProductPanel lookup={lookup} />
          {live && <ResumenIncidencias lista={todas} ctx={ctx} />}

          <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Familia de manufactura">
            <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 1 }}>Familia de manufactura</Typography>
            <FormControl error={Boolean(errors.familia)}>
              <FormLabel id="family-label">{form.familyOrigin === 'SUGERIDA' ? 'Familia sugerida (provisional): confírmala o cámbiala' : 'Selecciona la familia'}</FormLabel>
              <RadioGroup row aria-labelledby="family-label" value={form.family ?? ''} onChange={(e) => update((f) => selectFamily(f, e.target.value as FamilyCode, configs))}>
                {configs.map((c) => <FormControlLabel key={c.codigo} value={c.codigo} control={<Radio />} label={c.nombre} />)}
              </RadioGroup>
            </FormControl>
            {form.familyOrigin === 'SUGERIDA' && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                <Chip size="small" color="info" variant="outlined" label="Sugerida por el sistema (provisional)" data-testid="family-chip" />
                <Button size="small" onClick={() => update((f) => confirmFamily(f))}>Confirmar familia</Button>
              </Stack>
            )}
            {form.familyOrigin === 'USUARIO' && <Chip size="small" color="secondary" label="Familia elegida por el usuario" sx={{ mt: 0.5 }} data-testid="family-chip" />}
            {form.familyNote && (form.family || !todas.some((i) => i.id === 'MATERIAL_PAPEL_SIN_PLANTILLA')) && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="family-note">{form.family ? `Motivo: ${form.familyNote}` : `Sin familia sugerida. ${form.familyNote}`}</Typography>}
            {config && config.notas.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block" data-testid="family-particularity">{n}</Typography>)}
            <IncidenciasDeSeccion seccion="familia" />
          </Paper>

          <SectionCard title="Datos generales" seccion="datos">
            {text('codigo')}
            {text('descripcion', { multiline: true, minRows: 2 })}
            {text('producto')}
            <ClientField form={form} onRestore={restore} onChange={(value, source, ref) => update((f) => setFieldValue(f, 'cliente', value, source, ref))} />
            {text('fechaEmision', { type: 'date', helperText: 'Fecha local sugerida; editable. No es la fecha de alta en BIND ni la emisión definitiva.' })}
            {text('resinaVci', { helperText: 'Editable. Sugerencia según la composición; el porcentaje no es una obligación.' })}
          </SectionCard>

          {config && (has('colorHex') || has('colorNombre')) && (
            <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Color">
              <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 2 }}>Color</Typography>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                {config.colorDibujo && (
                  <FieldFrame form={form} fieldKey="colorPreset" error={errors.colorPreset} onRestore={restore}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {colorSwatch(form.fields.colorHex.value)}
                      <TextField select fullWidth label="Color" value={colorPreset} error={Boolean(errors.colorPreset)} onChange={(e) => update((f) => setColorPreset(f, e.target.value, config))}>
                        <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
                        {config.colores.map((c) => <MenuItem key={c.id} value={c.id}>{c.etiqueta} ({c.hex})</MenuItem>)}
                        <MenuItem value={COLOR_OTRO}>Otro</MenuItem>
                        {colorPreset !== '' && colorPreset !== COLOR_OTRO && !config.colores.some((c) => c.id === colorPreset) && <MenuItem value={colorPreset} disabled>{colorPreset} (no disponible en esta familia)</MenuItem>}
                      </TextField>
                    </Stack>
                  </FieldFrame>
                )}
                {config.colorDibujo && text('colorConcentracion', { onValue: (value) => update((f) => setColorConcentracion(f, value, config)), inputMode: 'decimal', helperText: 'Concentración del color. Es independiente del porcentaje de la resina VCI.' })}
                {config.variantes.length > 0 && (
                  <FieldFrame form={form} fieldKey="coexVariante" error={errors.coexVariante} onRestore={restore}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      {colorSwatch(config.variantes.find((v) => v.valor === form.fields.coexVariante.value)?.colorCuerpo ?? '')}
                      <TextField select fullWidth label="Variante COEX" value={form.fields.coexVariante.value} error={Boolean(errors.coexVariante)} onChange={(e) => update((f) => setCoexVariante(f, e.target.value, config))}>
                        <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
                        {config.variantes.map((v) => <MenuItem key={v.valor} value={v.valor}>{v.etiqueta} (cuerpo {v.colorCuerpo})</MenuItem>)}
                      </TextField>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block">Solo existen las variantes aprobadas; un color personalizado no genera una tercera variante COEX.</Typography>
                  </FieldFrame>
                )}
                {text('colorNombre', { helperText: 'Texto impreso en el campo Color del documento (editable).' })}
                {config.colorDibujo && (colorPreset === COLOR_OTRO
                  ? text('colorHex', { placeholder: '#RRGGBB', helperText: 'Color del dibujo para «Otro».' })
                  : <Typography variant="body2" color="text.secondary" data-testid="color-hex-readonly">{colorPreset ? `Color del dibujo: ${form.fields.colorHex.value}` : 'Elige un color para el dibujo.'}</Typography>)}
              </Box>
              <IncidenciasDeSeccion seccion="color" />
            </Paper>
          )}

          {config?.capas && (
            <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Capas COEX">
              <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 0.5 }}>Capas COEX</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>La formulación de cada capa es fija. Peso por capa sugerido: peso total ÷ 3, con cinco decimales. Libras de VCI sugeridas: peso de la capa × porcentaje de VCI ÷ 100, con seis decimales (el exterior es SIN VCI: 0). Los valores manuales o confirmados se conservan y se avisa si dejan de coincidir con el cálculo; «Restaurar» vuelve al cálculo.</Typography>
              <Button size="small" disabled={!form.fields.pesoLb.value.trim() || !config.pesosCapasRegla?.variantes.includes(form.fields.coexVariante.value) || !/^\d+(?:[.,]\d+)?$/.test(form.fields.pesoLb.value.trim()) || !(Number(form.fields.pesoLb.value.replace(',', '.')) > 0)} onClick={() => setReviewWeights(true)}>Revisar reemplazo de pesos por sugerencias</Button>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                {config.capas.map((capa) => (
                  <Box key={capa.id} sx={{ display: 'contents' }}>
                    <Typography variant="body2" sx={{ gridColumn: '1 / -1', fontWeight: 600 }} data-testid={`capa-${capa.id}`}>{capa.etiqueta}: {capa.resina}</Typography>
                    {text(capa.pesoKey, { inputMode: 'decimal' })}
                    {text(capa.lbKey, { inputMode: 'decimal' })}
                  </Box>
                ))}
              </Box>
              <IncidenciasDeSeccion seccion="capas" />
            </Paper>
          )}

          <SectionCard title="Composición y presentación" seccion="composicion">
            {radios('composicion', composiciones, (value) => update((f) => setComposition(f, value)), config?.composicionFija ?? null)}
            {radios('presentacion', [{ value: 'ROLLO', label: 'Rollo' }, { value: 'PAQUETE', label: 'Paquete' }])}
            {text('cantidad', { inputMode: 'numeric' })}
            {select('cantidadUnidad', CANTIDAD_UNIDADES)}
            {radios('modalidad', (config?.modalidades ?? []).map((m) => ({ value: m.valor, label: m.etiqueta, disabled: !m.habilitada, hint: m.motivo })))}
          </SectionCard>

          <SectionCard title="Medidas y peso" seccion="medidas">
            {text('ancho', { inputMode: 'decimal' })}
            {text('largo', { inputMode: 'decimal' })}
            {text('anchoRollo', { inputMode: 'decimal', helperText: 'Dato independiente del ancho; se imprime con la unidad de las medidas.' })}
            {text('fuelleTotal', { onValue: (value) => update((f) => setFuelleTotal(f, value)), inputMode: 'decimal', helperText: 'Auxiliar: se reparte en dos mitades editables. No se imprime.' })}
            {text('fuelleDerecho', { inputMode: 'decimal' })}
            {text('fuelleIzquierdo', { inputMode: 'decimal' })}
            {text('anchoDoblado', { inputMode: 'decimal', helperText: 'Cota técnica independiente; no se calcula.' })}
            {text('medidaPliegue', { inputMode: 'decimal', helperText: 'Cota técnica independiente; no se calcula.' })}
            {text('largoPresentacionFinal', { inputMode: 'decimal', helperText: 'Cota técnica independiente; no se calcula.' })}
            {text('anchoPresentacionFinal', { inputMode: 'decimal', helperText: 'Cota técnica independiente; no se calcula.' })}
            {select('unidadDimensiones', unidades.map((u) => [u.valor, u.etiqueta]))}
            {text('pesoLb', { inputMode: 'decimal' })}
            {text('calibre', { helperText: 'Valor literal de BIND (p. ej. 200, 2 MIL, 2.7). No se convierte ni se agrega unidad; corrígelo solo si es necesario.' })}
          </SectionCard>

          {config && (
            <SectionCard title={`Datos de ${config.nombre}`}>
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
                <Chip size="small" color={live.technicalReady ? 'success' : 'warning'} label={live.technicalReady ? 'Datos técnicos suficientes' : `Datos técnicos incompletos (${Object.keys(live.errors).length})`} data-testid="status-technical" />
                <Chip size="small" color={reviewed ? 'success' : 'warning'} label={reviewed ? 'Datos revisados para este borrador' : 'Datos pendientes de revisión'} data-testid="status-reviewed" />
                <Chip size="small" color={live.emissionReady && reviewed ? 'success' : 'default'} label={live.emissionReady && reviewed ? 'Apto para emisión futura (sin guardar)' : 'No apto para emisión futura'} data-testid="status-emission" />
                <Chip size="small" variant="outlined" label="Aprobación: fuera de alcance" data-testid="status-approval" />
              </Stack>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <Button variant="contained" onClick={() => setValidation(validateSpecification(form, configs, lookup))}>Validar especificación</Button>
              <Button variant="outlined" disabled={!live?.technicalReady || !currentAssessment?.completo || Boolean(currentAssessment?.bloqueado) || form.familyOrigin !== 'USUARIO' || sinReconocer.length > 0} onClick={() => { const confirmed = confirmLayerWeights(form); setForm(confirmed); setReviewedKey(JSON.stringify({ form: confirmed, producto: lookup?.producto })); }}>Confirmar revisión del borrador</Button>
              {sinReconocer.length > 0 && <Typography variant="body2" color="text.secondary" data-testid="review-blocked-hint">Corrige o reconoce las contradicciones técnicas ({sinReconocer.length}) para confirmar la revisión.</Typography>}
              <Typography variant="body2" color="text.secondary">
                {changedFields(form, config).length === 0 ? 'Sin cambios respecto a lo recuperado de BIND.' : `Campos modificados por el usuario: ${changedFields(form, config).map((k) => FIELD_LABELS[k]).join(', ')}.`}
              </Typography>
            </Stack>
            {validation && (
              <Stack spacing={1} sx={{ mt: 2 }}>
                {validation.emissionReady && reviewed
                  ? <Alert severity="success">Los datos técnicos están completos, hay cliente del catálogo y la familia fue confirmada: apto para una emisión futura. Aún no se guarda ni se emite ninguna hoja.</Alert>
                  : validation.technicalReady
                    ? <Alert severity="info">Datos técnicos suficientes para la vista previa. Aún no se guarda ni se emite ninguna hoja. El detalle de pendientes y requisitos de una emisión futura está en la revisión del borrador.</Alert>
                    : <Alert severity="error">Faltan datos técnicos o hay valores no válidos ({Object.keys(validation.errors).length}). Revisa los campos marcados. El borrador sigue visible, pero la representación es incompleta.</Alert>}
              </Stack>
            )}
          </Paper>
          <Dialog open={reviewWeights && Boolean(config?.pesosCapasRegla)} onClose={() => setReviewWeights(false)} aria-labelledby="review-layer-weights-title">
            <DialogTitle id="review-layer-weights-title">Revisar reemplazo de pesos por capa</DialogTitle>
            <DialogContent>
              <Alert severity="warning">Esta acción reemplaza también los pesos manuales o confirmados. Revisa los valores antes de continuar. No cambia las libras de VCI ni autoriza una especificación oficial.</Alert>
              {config?.pesosCapasRegla?.campos.map((key) => <Typography key={key} sx={{ mt: 1 }}>{FIELD_LABELS[key]}: {form.fields[key].value || 'vacío'} → {suggestLayerWeights(form, true).fields[key].value || 'sin sugerencia'}</Typography>)}
            </DialogContent>
            <DialogActions><Button onClick={() => setReviewWeights(false)}>Cancelar</Button><Button onClick={() => { update((f) => suggestLayerWeights(f, true)); setReviewWeights(false); }}>Reemplazar pesos por sugerencias actuales</Button></DialogActions>
          </Dialog>
        </Box>
        </IncidenciasProvider>
        <Box sx={{ minWidth: 0, order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 16 }, mt: 2 }}>
          <SheetPreviewPanel family={form.family} familyLabel={config?.nombre ?? ''} data={previewData} avisos={avisosVistaPrevia}
            context={previewContext}
            onAssessment={(result, key) => setAssessment(result ? { key, result } : null)} />
        </Box>
        </Box>
      )}
    </Box>
  );
}

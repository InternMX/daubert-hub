import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton, InputAdornment, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BreadcrumbNav } from '../components/BreadcrumbNav';
import { PageHeader } from '../components/PageHeader';
import { BIND_CODE_PATTERN, BindProductApiError, lookupBindProductByCode, type BindProductErrorKind, type BindProductLookup, type FuenteDato } from '../services/bindProducts';
import { listClients } from '../services/clients';
import { listManufacturingFamilies, type FamilyConfig } from '../services/manufacturingFamilies';
import { capacidadesDocumentales, DocumentApiError, documentErrorText, historialPorCodigo, obtenerDocumento, type DocumentoVista, type ResumenDocumento } from '../services/manufacturingDocuments';
import { useSearchParams } from 'react-router-dom';
import type { SheetPreviewResponse } from '../services/sheetPreview';
import { IncidenciasDeCampo, IncidenciasDeSeccion, IncidenciasProvider, ResumenIncidencias } from './IncidenciaViews';
import { localizar } from './incidenciasNavegacion';
import { buildIncidencias, estaReconocida, huella, type Incidencia, type Reconocimientos, type SeccionIncidencia } from './incidencias';
import { CUSTOM_COLORS_MAX, CUSTOM_COLOR_ERRORS, idDeColor, useCustomColors, type CustomColor, type CustomColorError } from './customColors';
import { abrirSinBind, construirCarga } from './documentSpec';
import { desdeVista, haciaEnvio, type ResponsableLocal } from './responsablesModelo';
import { etiquetaRevision } from './documentLabels';
import { BarraDocumento, DocumentoProvider, FinalizarHojaDocumento, ResponsablesDocumento, type BloqueoFinal, type EstadoDatos } from './DocumentPanel';
import { BotonMisHojas, HojasDelCodigo } from './HojasDelCodigo';
import { AuthContext } from '../auth/authContext.core';
import { AltaRapidaCliente } from './AltaRapidaCliente';
import { ClienteSugerencias, EnlaceConfiguracion } from './ClienteSugerencias';
import { NovedadesCatalogo } from './NovedadesCatalogo';
import { SheetPreviewPanel } from './SheetPreviewPanel';
import {
  buildInitialForm, changedFields, COLOR_OTRO, configOf, confirmFamily, displayOrigin, FIELD_LABELS, isEdited, restoreField, selectFamily, setColorConcentracion, setColorPreset, setComposition,
  setCoexVariante, setCustomColor, setFieldValue, setFuelleTotal, suggestLayerWeights, confirmLayerWeights, toPreviewData, validateSpecification,
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

interface TextExtra { label?: string; onValue?: (value: string) => void; type?: string; placeholder?: string; helperText?: string; multiline?: boolean; minRows?: number; inputMode?: 'numeric' | 'decimal' }

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

function ClientField({ form, onChange, onRestore, onUsarSugerencia, requerido }: { form: SpecificationForm; requerido?: boolean; onUsarSugerencia: (clienteId: string, nombre: string) => void; onChange: (value: string, source: 'CATALOGO' | 'PROVISIONAL' | undefined, ref?: string) => void; onRestore: (key: FieldKey) => void }) {
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [input, setInput] = useState(form.fields.cliente.value);
  // Alta rápida (solo ADMIN): se ofrece cuando la búsqueda del catálogo terminó SIN resultados para lo escrito. Una cuenta GENERAL conserva la captura manual de siempre.
  const esAdmin = useContext(AuthContext)?.user?.role === 'ADMIN';
  const [sinResultados, setSinResultados] = useState<string | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [creado, setCreado] = useState('');
  useEffect(() => {
    const term = input.trim();
    if (term.length < 2) { setOptions([]); setSinResultados(null); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      listClients({ search: term, sortOrder: 'asc', page: 1, pageSize: 10 })
        .then((result) => { if (!active) return; const lista = result.data.filter((client) => client.clientStatus === 'ACTIVO').map((client) => ({ id: client.id, name: client.commercialName })); setOptions(lista); setSinResultados(lista.length === 0 ? term : null); })
        .catch(() => { if (active) { setOptions([]); setSinResultados(null); } });
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
        renderInput={(params) => requerido
          ? <TextField {...params} label="Cliente (obligatorio para finalizar)" helperText="Selecciona un cliente del catálogo o escribe su nombre." />
          : <TextField {...params} label="Cliente (opcional)" helperText="Selecciona un cliente del catálogo o escribe su nombre." />}
      />
      {esAdmin && current.source !== 'CATALOGO' && sinResultados !== null && sinResultados === input.trim() && (
        <Typography variant="caption" color="text.secondary" display="block" data-testid="alta-rapida-oferta" sx={{ mt: 0.5 }}>
          ¿No encuentras «{input.trim()}» en el catálogo?
          <Button size="small" variant="text" onClick={() => { setAltaAbierta(true); setCreado(''); }} sx={{ textTransform: 'none', px: 0.75, minWidth: 0 }}>Registrar cliente</Button>
        </Typography>
      )}
      {creado && <Typography variant="caption" color="success.main" display="block" role="status" data-testid="alta-rapida-aviso" sx={{ mt: 0.5 }}>{creado}</Typography>}
      <ClienteSugerencias codigo={form.fields.codigo.value} actual={current} onUsar={onUsarSugerencia} />
      {esAdmin && (
        <AltaRapidaCliente open={altaAbierta} nombreInicial={input.trim()} onClose={() => setAltaAbierta(false)}
          onCreado={(c) => { setAltaAbierta(false); setSinResultados(null); setCreado(c.nuevo ? `Cliente «${c.nombre}» registrado y seleccionado.` : `Cliente «${c.nombre}» seleccionado.`); onChange(c.nombre, 'CATALOGO', c.id); }} />
      )}
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

interface BindPanelProps { lookup: BindProductLookup; guardado: boolean; actual: BindActual; onConsultar: () => void }
function BindProductPanel({ lookup, guardado, actual, onConsultar }: BindPanelProps) {
  const { producto } = lookup;
  const rows: Array<[string, string]> = [
    ...(guardado ? [] : [['ID en BIND', producto.ID] as [string, string]]), ['Código (Code)', producto.Code], ['Descripción comercial (Title)', producto.Title],
    ['Información adicional (Description)', producto.Description ?? '—'], ['Peso (Weight, lb)', producto.Weight === null ? '—' : String(producto.Weight)],
    ['Fecha de alta en BIND', formatDate(producto.CreationDate)]
  ];
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mt: 2 }} aria-label="Producto en BIND">
      <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap>
        <Typography variant="h2" sx={{ fontSize: '1.25rem', fontWeight: 700 }} data-testid="bind-codigo">{producto.Code}</Typography>
        <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }} data-testid="bind-descripcion">{producto.Title}</Typography>
        <Chip size="small" label={guardado ? 'Copia de BIND guardada con la hoja' : 'Solo lectura'} />
        <Chip size="small" color="warning" variant="outlined" label="Especificación no confirmada" />
      </Stack>
      {guardado && (
        <Box sx={{ mt: 1 }} data-testid="bind-guardado">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">La hoja se abrió sin consultar BIND; ninguna consulta posterior reemplaza lo guardado.</Typography>
            <Button size="small" onClick={onConsultar} disabled={actual.estado === 'cargando'}>Consultar BIND ahora (solo lectura)</Button>
          </Stack>
          {actual.estado === 'cargando' && <Typography variant="body2" sx={{ mt: 0.5 }}>Consultando BIND…</Typography>}
          {actual.estado === 'error' && <Alert severity="warning" sx={{ mt: 1 }}>{actual.mensaje} El documento abierto no se ve afectado.</Alert>}
          {actual.estado === 'listo' && (
            <Alert severity="info" sx={{ mt: 1 }} data-testid="bind-actual">
              <b>BIND hoy</b> (informativo; no se aplicó nada al borrador): Title «{actual.producto.Title}» · Weight {actual.producto.Weight === null ? '—' : String(actual.producto.Weight)} lb.
              {actual.producto.Title !== producto.Title || String(actual.producto.Weight ?? '') !== String(producto.Weight ?? '') ? ' Difiere de la copia guardada.' : ' Coincide con la copia guardada.'}
            </Alert>
          )}
        </Box>
      )}
      <IncidenciasDeSeccion seccion="bind" />
      <Accordion disableGutters elevation={0} sx={{ mt: 1, '&:before': { display: 'none' }, bgcolor: 'transparent' }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 0, minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
          <Typography variant="body2" color="text.secondary">Detalles del producto en BIND</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0, pt: 0 }}>
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(180px, 30%) 1fr' }, columnGap: 2, rowGap: 0.75 }}>
            {rows.map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{value}</Typography>
              </Box>
            ))}
          </Box>
          <MaterialRow lookup={lookup} />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>La fecha de alta es la del producto en BIND, no la fecha de emisión de la hoja. Estos datos no se modifican desde esta pantalla.</Typography>
        </AccordionDetails>
      </Accordion>
    </Paper>
  );
}

type BindActual = { estado: 'inactivo' } | { estado: 'cargando' } | { estado: 'error'; mensaje: string } | { estado: 'listo'; producto: BindProductLookup['producto'] };
const PERSONAL = 'PERSONAL:';
const CANTIDAD_UNIDADES: Array<[string, string]> = [['BOLSAS', 'Bolsas'], ['HOJAS', 'Hojas']];

/** El gestor documental (guardar, revisar, finalizar) solo se muestra cuando el backend lo tiene activo: `VITE_MANUFACTURING_DOCUMENTS=true`. Apagado por defecto. */
export const DOCUMENTOS_ACTIVOS = import.meta.env.VITE_MANUFACTURING_DOCUMENTS === 'true';

export function ManufacturingSpecificationPage({ documentos = DOCUMENTOS_ACTIVOS, retardoAutoguardado = 1500 }: { documentos?: boolean; retardoAutoguardado?: number } = {}) {
  const [configs, setConfigs] = useState<FamilyConfig[]>([]);
  const [configStatus, setConfigStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorKind, setErrorKind] = useState<BindProductErrorKind | null>(null);
  const [lookup, setLookup] = useState<BindProductLookup | null>(null);
  const [desdeGuardado, setDesdeGuardado] = useState(false);
  // Búsqueda unificada (gestor documental activo): código buscado, hojas accesibles y producto de BIND de ESA búsqueda (para preparar hojas nuevas).
  const [ediciones, setEdiciones] = useState(0);   // ediciones reales del usuario (el guardado automático no se dispara por lo que el formulario normaliza al abrir)
  const [busqueda, setBusqueda] = useState<string | null>(null);
  const [hojas, setHojas] = useState<ResumenDocumento[] | null>(null);
  const [hojasEstado, setHojasEstado] = useState<'cargando' | 'listo' | 'error'>('listo');
  const [hojasError, setHojasError] = useState('');
  const [bindBusqueda, setBindBusqueda] = useState<BindProductLookup | null>(null);
  const busquedaRef = useRef<string | null>(null);
  const [docActual, setDocActual] = useState<DocumentoVista | null>(null);
  const [listaFormatos, setListaFormatos] = useState(false);                         // se muestran los siete formatos («Elegir otro formato» / «Cambiar»)
  // Responsables y firmas: se editan aquí (son parte de lo que se guarda solo) y se envían únicamente cuando el usuario los toca; abrir una hoja no los modifica.
  const [responsables, setResponsables] = useState<ResponsableLocal[]>(desdeVista([]));
  const [respEditados, setRespEditados] = useState(false);
  const [puedeFirmas, setPuedeFirmas] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);                           // confirmación breve (p. ej. «Borrador descartado.»)
  const [familiaPendiente, setFamiliaPendiente] = useState<FamilyCode | null>(null);   // cambio de familia de una hoja ya guardada, a la espera de confirmación
  const [bindActual, setBindActual] = useState<BindActual>({ estado: 'inactivo' });
  const bindController = useRef<AbortController | null>(null);
  const [form, setForm] = useState<SpecificationForm | null>(null);
  const [validation, setValidation] = useState<SpecificationValidation | null>(null);
  const [intentoFinal, setIntentoFinal] = useState(false);   // gestor documental: el usuario intentó finalizar y había bloqueos
  const [assessment, setAssessment] = useState<{ key: string; result: SheetPreviewResponse } | null>(null);
  const [reviewedKey, setReviewedKey] = useState('');
  const [reviewWeights, setReviewWeights] = useState(false);
  const [reconocidas, setReconocidas] = useState<Reconocimientos>({});
  const [reveladas, setReveladas] = useState<ReadonlySet<string>>(new Set());
  const [fallo, setFallo] = useState('');
  const personalizados = useCustomColors();
  const [colorError, setColorError] = useState<CustomColorError | null>(null);
  const [editorColorAbierto, setEditorColorAbierto] = useState(false);
  const [colorGuardado, setColorGuardado] = useState<{ nombre: string; persistido: boolean } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!documentos) return undefined;
    const c = new AbortController();
    capacidadesDocumentales(c.signal).then((r) => setPuedeFirmas(r.firmas)).catch(() => setPuedeFirmas(false));
    return () => c.abort();
  }, [documentos]);
  useEffect(() => {
    const abort = new AbortController();
    listManufacturingFamilies(abort.signal).then((list) => { setConfigs(list); setConfigStatus('ready'); }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setConfigStatus('error');
    });
    return () => abort.abort();
  }, []);

  // `codigo` permite iniciar la MISMA búsqueda desde «Novedades del catálogo» («Preparar hoja»): nada se interpreta aparte. Cada búsqueda anula la anterior y descarta su respuesta tardía.
  async function search(codigo?: string): Promise<void> {
    const target = codigo ?? code;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setMensaje(null); setListaFormatos(false);
    setValidation(null);
    setReviewedKey('');
    setReviewWeights(false);
    setReconocidas({});
    setReveladas(new Set());
    setFallo('');
    setColorError(null); setColorGuardado(null); setEditorColorAbierto(false);
    if (!BIND_CODE_PATTERN.test(target.trim())) {
      setStatus('error'); setErrorKind('INVALID_CODE'); setLookup(null); setForm(null);
      return;
    }
    setStatus('loading'); setErrorKind(null); setDesdeGuardado(false); setBindActual({ estado: 'inactivo' });
    if (documentos) {
      // Punto de entrada unificado: hojas accesibles del código (endpoint documental existente) + producto en BIND, en paralelo. Ninguna de las dos cosas crea ni modifica nada.
      const clave = target.trim();
      busquedaRef.current = clave;
      setBusqueda(clave); setHojas(null); setHojasEstado('cargando'); setHojasError(''); setBindBusqueda(null); setLookup(null); setForm(null);
      const [h, b] = await Promise.allSettled([historialPorCodigo(clave, current.signal), lookupBindProductByCode(clave, current.signal)]);
      if (current.signal.aborted) return;
      if (h.status === 'fulfilled') { setHojas(h.value.data); setHojasEstado('listo'); }
      else { setHojas(null); setHojasEstado('error'); setHojasError(h.reason instanceof DocumentApiError ? documentErrorText[h.reason.kind] : documentErrorText.NETWORK); }
      if (b.status === 'fulfilled') { setBindBusqueda(b.value); setLookup(b.value); setStatus('ready'); }
      else { setLookup(null); setStatus('error'); setErrorKind(b.reason instanceof BindProductApiError ? b.reason.kind : 'NETWORK'); }
      return;
    }
    try {
      const result = await lookupBindProductByCode(target, current.signal);
      if (current.signal.aborted) return;
      setLookup(result); setForm(buildInitialForm(result, configs)); setStatus('ready');
    } catch (error) {
      if (current.signal.aborted) return;
      setLookup(null); setForm(null); setStatus('error');
      setErrorKind(error instanceof BindProductApiError ? error.kind : 'NETWORK');
    }
  }

  // Abrir un documento guardado: NO consulta BIND. El formulario se reconstruye con el motor de especificaciones sobre la copia guardada (Code/Title/etc. de BIND incluidos en el documento) y los
  // valores guardados mandan. Abrir no modifica nada: la versión documental solo cambia cuando el usuario guarda.
  function abrirDocumento(doc: DocumentoVista): void {
    controller.current?.abort();            // una búsqueda a BIND en curso no debe pisar el documento abierto
    const abierto = abrirSinBind(doc, configs);
    setMensaje(null); setListaFormatos(false);
    setValidation(null); setIntentoFinal(false); setReviewedKey(''); setReviewWeights(false); setReveladas(new Set()); setFallo(''); setColorError(null); setColorGuardado(null); setEditorColorAbierto(false);
    setBindActual({ estado: 'inactivo' }); setCode(doc.codigo); setErrorKind(null);
    if (documentos && busquedaRef.current?.toLowerCase() !== doc.codigo.toLowerCase()) { busquedaRef.current = doc.codigo; setBusqueda(doc.codigo); setBindBusqueda(null); void recargarHojas(doc.codigo); }
    setLookup(abierto.lookup); setForm(abierto.form); setReconocidas(abierto.reconocidas); setDesdeGuardado(true); setStatus('ready');
    setResponsables(desdeVista(doc.responsables ?? [])); setRespEditados(false);
  }

  // Enlace directo a una hoja (p. ej. desde «Actividad reciente»): /…/manufacturing-sheets?revision=<uuid>. Abrir un documento NO modifica nada (la base decide el acceso: un borrador ajeno responde 404).
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [parametros, setParametros] = useSearchParams();
  const revisionDeEnlace = parametros.get('revision');
  useEffect(() => {
    if (!documentos || configStatus !== 'ready' || !revisionDeEnlace) return undefined;
    const quitar = (): void => setParametros((p) => { const n = new URLSearchParams(p); n.delete('revision'); return n; }, { replace: true });
    if (!/^[0-9a-f-]{36}$/i.test(revisionDeEnlace)) { quitar(); return undefined; }
    let activo = true;
    obtenerDocumento(revisionDeEnlace)
      .then((d) => { if (activo) abrirDocumento(d); })
      .catch((e: unknown) => { if (activo) setErrorEnlace(e instanceof DocumentApiError ? (e.kind === 'NOT_FOUND' ? 'La hoja ya no está disponible o no tienes acceso a ella.' : documentErrorText[e.kind]) : documentErrorText.NETWORK); })
      .finally(() => { if (activo) quitar(); });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo debe reaccionar al enlace y a que las familias estén listas
  }, [documentos, configStatus, revisionDeEnlace]);

  // Consulta EXPLÍCITA de los datos actuales de BIND, solo lectura: no toca el formulario, el borrador ni lo guardado, y su indisponibilidad no afecta al documento abierto.
  async function consultarBindActual(): Promise<void> {
    if (!lookup) return;
    const current = new AbortController();
    bindController.current?.abort(); bindController.current = current;
    setBindActual({ estado: 'cargando' });
    try {
      const result = await lookupBindProductByCode(lookup.producto.Code, current.signal);
      if (!current.signal.aborted) setBindActual({ estado: 'listo', producto: result.producto });
    } catch (error) {
      if (!current.signal.aborted) setBindActual({ estado: 'error', mensaje: errorMessages[error instanceof BindProductApiError ? error.kind : 'NETWORK'] });
    }
  }

  // Un documento que aparece (p. ej. el borrador recién creado) trae sus responsables: se muestran tal cual (nombre sugerido desde la cuenta). No cuenta como edición.
  useEffect(() => {
    if (docActual) { setResponsables(desdeVista(docActual.responsables ?? [])); setRespEditados(false); }
  }, [docActual?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiarResponsables = (r: ResponsableLocal[]): void => { setResponsables(r); setRespEditados(true); setEdiciones((n) => n + 1); };
  const soloLectura = documentos && docActual !== null && (docActual.estado !== 'BORRADOR' || !docActual.permisos.editar);

  async function recargarHojas(codigo: string): Promise<void> {
    try {
      const r = await historialPorCodigo(codigo);
      if (busquedaRef.current?.toLowerCase() === codigo.toLowerCase()) { setHojas(r.data); setHojasEstado('listo'); }
    } catch (error) {
      if (busquedaRef.current?.toLowerCase() === codigo.toLowerCase()) { setHojasEstado('error'); setHojasError(error instanceof DocumentApiError ? documentErrorText[error.kind] : documentErrorText.NETWORK); }
    }
  }
  // Los cambios del documento (guardar, finalizar, nueva revisión…) se reflejan en la lista de hojas del código.
  useEffect(() => {
    if (documentos && busquedaRef.current && docActual) void recargarHojas(busquedaRef.current);
  }, [docActual?.id, docActual?.estado, docActual?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // «Preparar una hoja nueva»: formulario inicial desde BIND (la búsqueda ya lo trajo). No guarda nada hasta «Guardar borrador».
  function prepararNueva(): void {
    if (!bindBusqueda) return;
    controller.current?.abort();
    setMensaje(null); setListaFormatos(false);
    setValidation(null); setIntentoFinal(false); setReviewedKey(''); setReviewWeights(false); setReveladas(new Set()); setFallo(''); setColorError(null); setColorGuardado(null); setEditorColorAbierto(false);
    setBindActual({ estado: 'inactivo' }); setReconocidas({}); setDesdeGuardado(false);
    setLookup(bindBusqueda); setForm(buildInitialForm(bindBusqueda, configs)); setStatus('ready');
  }

  // El borrador se descartó en el servidor: se cierra el formulario, se vuelve a la búsqueda del código (con su producto de BIND si la búsqueda lo trajo) y se refrescan las hojas.
  // «Mis hojas» se consulta cada vez que se abre, así que ya no incluye la hoja descartada.
  function alDescartar(d: DocumentoVista): void {
    controller.current?.abort();
    setValidation(null); setIntentoFinal(false); setReviewedKey(''); setReviewWeights(false); setReveladas(new Set()); setFallo(''); setColorError(null); setColorGuardado(null); setEditorColorAbierto(false);
    setBindActual({ estado: 'inactivo' }); setReconocidas({}); setDesdeGuardado(false); setFamiliaPendiente(null);
    setForm(null); setLookup(bindBusqueda); setStatus('ready'); setListaFormatos(false); setMensaje('Borrador descartado.'); setResponsables(desdeVista([])); setRespEditados(false);
    void recargarHojas(d.codigo);
  }

  const update = (updater: (previous: SpecificationForm) => SpecificationForm): void => {
    setEdiciones((n) => n + 1);
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
          fullWidth label={extra.label ?? FIELD_LABELS[key]} value={form.fields[key].value} error={Boolean(errors[key])} onChange={(e) => (extra.onValue ? extra.onValue(e.target.value) : setValue(key, e.target.value))}
          type={extra.type} placeholder={extra.placeholder} helperText={extra.helperText} multiline={extra.multiline} minRows={extra.minRows}
          slotProps={{ htmlInput: extra.inputMode ? { inputMode: extra.inputMode } : {}, inputLabel: extra.type === 'date' ? { shrink: true } : {} }}
        />
      </FieldFrame>
    )
  );
  // Elegir familia ES empezar: confirma la sugerida o cambia de familia. Si la hoja ya está guardada con otra familia, se pide confirmación antes de cambiarla (no se sobrescribe sin avisar).
  const elegirFamilia = (familia: FamilyCode): void => {
    if (documentos && docActual?.estado === 'BORRADOR' && docActual.familia !== familia) { setFamiliaPendiente(familia); return; }
    setListaFormatos(false);
    update((f) => (f.family === familia ? confirmFamily(f) : selectFamily(f, familia, configs)));
  };
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

  // Gestor documental: el formulario técnico y la vista previa aparecen cuando el usuario elige el formato (la recomendación no cuenta como elegida).
  const sinElegir = Boolean(documentos && form && form.familyOrigin !== 'USUARIO');
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
  const reconocer = (i: Incidencia): void => { setEdiciones((n) => n + 1); setReconocidas((r) => ({ ...r, [i.id]: huella(i, valores) })); };
  const deshacer = (i: Incidencia): void => { setEdiciones((n) => n + 1); setReconocidas((r) => Object.fromEntries(Object.entries(r).filter(([id]) => id !== i.id))); };
  const revision: 'vigente' | 'revisando' | 'no-disponible' = !form?.family || currentAssessment ? 'vigente' : fallo === assessmentKey ? 'no-disponible' : 'revisando';
  const revelar = (id: string): void => setReveladas((r) => (r.has(id) ? r : new Set(r).add(id)));
  // Datos obligatorios pendientes para finalizar. Coincide con el servidor: el cliente es obligatorio (texto libre válido en TEST); el catálogo solo lo verifica. Ver `motivosNoLista`.
  const faltantesFinal = todas.filter((i) => i.nivel === 'ERROR' || i.codigo === 'FALTANTE' || (i.codigo === 'CLIENTE_SIN_IDENTIFICAR' && valores('cliente').trim() === ''));
  const pendientes = documentos ? new Set(faltantesFinal.map((i) => i.id)) : undefined;
  const ctx = { pendientes, lista: todas, visible: (key: FieldKey): boolean => (config ? config.campos.includes(key) : true), valores, reconocidas, reconocer, deshacer, validado: intentoFinal || validation !== null, reveladas, revelar, revision };
  const reviewed = reviewedKey === reviewKey && Boolean(currentAssessment?.completo) && !currentAssessment?.bloqueado && Boolean(live?.technicalReady) && form?.familyOrigin === 'USUARIO' && sinReconocer.length === 0;
  // Validación automática (modo gestor documental): ninguna acción manual. Mientras no haya respuesta VIGENTE del servidor para estos datos no se afirma que estén completos.
  const estadoDatos: EstadoDatos = !form || revision === 'revisando' ? 'comprobando'
    : revision === 'no-disponible' ? 'no-disponible'
      : faltantesFinal.length > 0 || (currentAssessment !== null && !currentAssessment.completo) ? 'faltan'
        : sinReconocer.length > 0 || avisosVistaPrevia.length > 0 ? 'observaciones' : 'completos';
  const bloqueosFinal: BloqueoFinal[] = [
    ...(documentos && docActual?.estado === 'BORRADOR' && (responsables[0]?.nombre ?? '').trim() === '' ? [{ clave: 'genero', texto: 'Indica el nombre de quien generó la hoja.', irA: () => { const c = document.getElementById('responsables-seccion'); c?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); c?.querySelector<HTMLElement>('input')?.focus(); } }] : []),
    ...faltantesFinal.map((i) => ({ clave: i.id, texto: i.codigo === 'CLIENTE_SIN_IDENTIFICAR' ? 'Falta identificar al cliente.' : i.resumen ?? i.mensaje, irA: () => localizar(i, ctx) })),
    ...sinReconocer.map((i) => ({ clave: i.id, texto: `Contradicción por reconocer: ${i.resumen ?? i.mensaje}`, irA: () => localizar(i, ctx) })),
    ...(faltantesFinal.length === 0 && currentAssessment !== null && !currentAssessment.completo ? [{ clave: 'hoja-incompleta', texto: 'La hoja está incompleta según la comprobación del servidor.' }] : [])
  ];
  const colorPreset = form?.fields.colorPreset.value ?? '';
  // Un color personalizado guardado se reconoce por sus VALORES (nombre + HEX): si el usuario edita cualquiera de los dos, deja de estar «seleccionado» y vuelve el editor.
  const personalCoincidente: CustomColor | undefined = form && colorPreset === COLOR_OTRO ? personalizados.colores.find((c) => c.id === idDeColor(form.fields.colorNombre.value, form.fields.colorHex.value)) : undefined;
  const colorSelect = personalCoincidente && !editorColorAbierto ? `${PERSONAL}${personalCoincidente.id}` : colorPreset;
  const elegirColor = (valor: string, cfg: FamilyConfig): void => {
    setColorError(null); setColorGuardado(null); setEditorColorAbierto(valor === COLOR_OTRO);
    const personal = valor.startsWith(PERSONAL) ? personalizados.colores.find((c) => `${PERSONAL}${c.id}` === valor) : undefined;
    if (personal) update((f) => setCustomColor(f, personal.nombre, personal.hex)); else update((f) => setColorPreset(f, valor, cfg));
  };
  const guardarColor = (): void => {
    if (!form) return;
    const r = personalizados.agregar(form.fields.colorNombre.value, form.fields.colorHex.value);
    if (!r.ok) { setColorError(r.error); setColorGuardado(null); return; }
    setColorError(null); setEditorColorAbierto(false);
    setColorGuardado({ nombre: r.color.nombre, persistido: r.persistido });
    update((f) => setCustomColor(f, r.color.nombre, r.color.hex));
  };
  const colorSwatch = (hex: string) => <Box aria-label="Muestra del color" role="img" data-testid="color-swatch" sx={{ width: 32, height: 32, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : 'transparent', flexShrink: 0 }} />;
  const composiciones = (config?.composiciones ?? ['PMG', 'CP5000', 'NAT']).map((value) => ({ value, label: value === 'NAT' ? 'Natural' : value }));

  const contenido = (
    <Box sx={{ maxWidth: 1500, minWidth: 0 }}>
      <BreadcrumbNav items={[{ label: 'Inicio', to: '/' }, { label: 'Automatizaciones', to: '/automations' }, { label: 'Hojas de manufactura' }]} />
      <PageHeader title="Especificación de manufactura" description={documentos
        ? 'Escribe el código DCMX del producto: verás sus hojas guardadas y podrás continuar una, ver su historial y PDF, crear una nueva revisión o preparar una hoja nueva. Todo documento es de PRUEBA y no es válido para producción.'
        : 'Busca un producto en BIND por su código DCMX, revisa y corrige los datos interpretados y selecciona la familia. Los datos solo existen en memoria: no se guardan ni se emite ninguna hoja.'}>
        <EnlaceConfiguracion />
      </PageHeader>

      {configStatus === 'error' && <Alert severity="error" sx={{ mt: 2 }}>No se pudo cargar la configuración de las familias de manufactura. Recarga la página.</Alert>}

      <Paper component="form" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 3 }} onSubmit={(e) => { e.preventDefault(); void search(); }} aria-label="Buscar producto en BIND">
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <TextField
            label="Código DCMX a buscar" value={code} onChange={(e) => setCode(e.target.value)} fullWidth autoComplete="off" placeholder="Ej. SCHFPMG001"
            helperText={documentos ? 'Búsqueda exacta por código DCMX: hojas guardadas y producto en BIND (solo lectura).' : 'Búsqueda exacta por código en BIND (solo lectura).'}
            slotProps={{ htmlInput: { maxLength: 64 }, input: { endAdornment: status === 'loading' ? <InputAdornment position="end"><CircularProgress size={18} aria-label="Buscando" /></InputAdornment> : undefined } }}
          />
          <Button type="submit" variant="contained" startIcon={<SearchRoundedIcon />} disabled={status === 'loading' || code.trim() === '' || configStatus !== 'ready'} sx={{ minWidth: 190, mt: { sm: 0.5 } }}>{documentos ? 'Buscar' : 'Buscar en BIND'}</Button>
          {documentos && <BotonMisHojas />}
        </Stack>
      </Paper>

      <NovedadesCatalogo
        familyName={(c) => configs.find((x) => x.codigo === c)?.nombre ?? c}
        activeCode={lookup?.producto.Code ?? null}
        disabled={configStatus !== 'ready'}
        onPrepare={(c) => { setCode(c); void search(c); }}
      />

      {errorEnlace && <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setErrorEnlace(null)} data-testid="error-enlace">{errorEnlace}</Alert>}
      {mensaje && <Alert severity="success" sx={{ mt: 2 }} role="status" onClose={() => setMensaje(null)} data-testid="mensaje-pagina">{mensaje}</Alert>}

      {documentos && busqueda && (
        <HojasDelCodigo
          codigo={busqueda} hojas={hojas} estado={hojasEstado} error={hojasError}
          producto={bindBusqueda ? { Code: bindBusqueda.producto.Code, Title: bindBusqueda.producto.Title } : null}
          bindError={status === 'error' && errorKind && errorKind !== 'INVALID_CODE' ? errorMessages[errorKind] : null}
          puedePreparar={Boolean(bindBusqueda) && configStatus === 'ready'} formAbierto={Boolean(form)} onPreparar={prepararNueva}
        />
      )}

      {status === 'loading' && <Alert severity="info" sx={{ mt: 2 }}>Consultando BIND…</Alert>}
      {status === 'error' && errorKind && !(documentos && busqueda) && <Alert severity={errorKind === 'NOT_FOUND' ? 'info' : 'error'} sx={{ mt: 2 }}>{errorMessages[errorKind]}</Alert>}

      {status === 'ready' && lookup && form && (
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(420px, 520px)' }, alignItems: 'start' }}>
        <IncidenciasProvider value={ctx}>
        {/* Una revisión finalizada (o un borrador que esta cuenta no puede editar) se abre en solo lectura: el fieldset deshabilita todos los controles; el servidor sigue siendo la autoridad. */}
        <Box sx={{ minWidth: 0, order: { xs: 2, lg: 1 } }}>
        {documentos && <BarraDocumento />}
        <Box component="fieldset" disabled={soloLectura} data-testid="formulario-documento" sx={{ minWidth: 0, border: 0, p: 0, m: 0 }}>
          <BindProductPanel lookup={lookup} guardado={desdeGuardado} actual={bindActual} onConsultar={() => { void consultarBindActual(); }} />
          {live && !sinElegir && <ResumenIncidencias lista={todas} ctx={ctx} />}

          {documentos ? (
            <Paper component="section" variant="outlined" sx={{ p: 2, mt: 2 }} aria-label="Formato de la hoja">
              {form.familyOrigin === 'USUARIO' && !listaFormatos ? (
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography data-testid="formato-actual">Formato: <b>{config?.nombre ?? form.family}</b></Typography>
                  {!soloLectura && <Button size="small" onClick={() => setListaFormatos(true)}>Cambiar</Button>}
                </Stack>
              ) : form.familyOrigin === 'SUGERIDA' && !listaFormatos ? (
                <Box data-testid="formato-recomendado">
                  <Typography variant="subtitle1" component="h2">Formato recomendado: <b>{config?.nombre ?? form.family}</b></Typography>
                  {form.familyNote && <Typography variant="body2" color="text.secondary" data-testid="family-note">{form.familyNote}</Typography>}
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                    <Button variant="contained" onClick={() => form.family && elegirFamilia(form.family)}>Usar este formato</Button>
                    <Button variant="outlined" onClick={() => setListaFormatos(true)}>Elegir otro formato</Button>
                  </Stack>
                </Box>
              ) : (
                <FormControl error={Boolean(errors.familia)}>
                  <FormLabel id="family-label">{form.family === null ? 'No hay un formato recomendado para este producto: elige el formato' : 'Elige el formato'}</FormLabel>
                  {form.family === null && form.familyNote && !todas.some((i) => i.id === 'MATERIAL_PAPEL_SIN_PLANTILLA') && <Typography variant="body2" color="text.secondary" data-testid="family-note">{form.familyNote}</Typography>}
                  <RadioGroup row aria-labelledby="family-label" value={form.familyOrigin === 'USUARIO' ? (form.family ?? '') : ''} onChange={(e) => elegirFamilia(e.target.value as FamilyCode)}>
                    {configs.map((c) => <FormControlLabel key={c.codigo} value={c.codigo} control={<Radio />} label={c.nombre} />)}
                  </RadioGroup>
                  {form.family !== null && <Box><Button size="small" onClick={() => setListaFormatos(false)}>{form.familyOrigin === 'USUARIO' ? 'Mantener el formato' : 'Volver a la recomendación'}</Button></Box>}
                </FormControl>
              )}
              {!sinElegir && config && config.notas.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block" data-testid="family-particularity">{n}</Typography>)}
              <IncidenciasDeSeccion seccion="familia" />
            </Paper>
          ) : (
          <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mt: 2 }} aria-label="Familia de manufactura">
            <Typography variant="h2" sx={{ fontSize: '1.125rem', mb: 1 }}>Familia de manufactura</Typography>
            <FormControl error={Boolean(errors.familia)}>
              <FormLabel id="family-label">{form.familyOrigin === 'SUGERIDA' ? (documentos ? 'Familia sugerida (provisional): elígela para empezar o cambia de familia' : 'Familia sugerida (provisional): confírmala o cámbiala') : 'Selecciona la familia'}</FormLabel>
              <RadioGroup row aria-labelledby="family-label" value={form.family ?? ''} onChange={(e) => elegirFamilia(e.target.value as FamilyCode)}>
                {configs.map((c) => <FormControlLabel key={c.codigo} value={c.codigo} control={<Radio onClick={() => { if (documentos && form.family === c.codigo && form.familyOrigin === 'SUGERIDA') elegirFamilia(c.codigo); }} />} label={c.nombre} />)}
              </RadioGroup>
            </FormControl>
            {form.familyOrigin === 'SUGERIDA' && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                <Chip size="small" color="info" variant="outlined" label="Sugerida por el sistema (provisional)" data-testid="family-chip" />
                {documentos
                  ? <Typography variant="caption" color="text.secondary">Pulsa la familia (la sugerida u otra) para empezar a trabajar: hasta entonces no se guarda nada.</Typography>
                  : <Button size="small" onClick={() => update((f) => confirmFamily(f))}>Confirmar familia</Button>}
              </Stack>
            )}
            {form.familyOrigin === 'USUARIO' && <Chip size="small" color="secondary" label="Familia elegida por el usuario" sx={{ mt: 0.5 }} data-testid="family-chip" />}
            {form.familyNote && (form.family || !todas.some((i) => i.id === 'MATERIAL_PAPEL_SIN_PLANTILLA')) && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="family-note">{form.family ? `Motivo: ${form.familyNote}` : `Sin familia sugerida. ${form.familyNote}`}</Typography>}
            {config && config.notas.map((n) => <Typography key={n} variant="caption" color="text.secondary" display="block" data-testid="family-particularity">{n}</Typography>)}
            <IncidenciasDeSeccion seccion="familia" />
          </Paper>
          )}

          {!sinElegir && (<>
          <SectionCard title="Datos generales" seccion="datos">
            {text('codigo')}
            {text('descripcion', { multiline: true, minRows: 2 })}
            {text('producto')}
            <ClientField form={form} requerido={documentos} onRestore={restore} onUsarSugerencia={(clienteId, nombre) => update((f) => setFieldValue(f, 'cliente', nombre, 'CATALOGO', clienteId))} onChange={(value, source, ref) => update((f) => setFieldValue(f, 'cliente', value, source, ref))} />
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
                      <TextField select fullWidth label="Color" value={colorSelect} error={Boolean(errors.colorPreset)} onChange={(e) => elegirColor(e.target.value, config)}>
                        <MenuItem value=""><em>Sin seleccionar</em></MenuItem>
                        {config.colores.map((c) => <MenuItem key={c.id} value={c.id}>{c.etiqueta} ({c.hex})</MenuItem>)}
                        {personalizados.colores.map((c) => <MenuItem key={c.id} value={`${PERSONAL}${c.id}`}>{c.nombre} ({c.hex}) · personalizado</MenuItem>)}
                        <MenuItem value={COLOR_OTRO}>Otro color…</MenuItem>
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
                {text('colorNombre', colorSelect === COLOR_OTRO && config.colorDibujo ? { label: 'Nombre del color', helperText: 'Se imprime en el campo Color del documento.' } : { helperText: 'Texto impreso en el campo Color del documento (editable).' })}
                {config.colorDibujo && (colorSelect === COLOR_OTRO
                  ? (
                    <FieldFrame form={form} fieldKey="colorHex" error={errors.colorHex} onRestore={restore}>
                      <Stack spacing={1.5} data-testid="color-personalizado-editor">
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Box component="input" type="color" aria-label="Selector visual de color" value={/^#[0-9A-Fa-f]{6}$/.test(form.fields.colorHex.value.trim()) ? form.fields.colorHex.value.trim() : '#000000'} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setColorError(null); setColorGuardado(null); setValue('colorHex', e.target.value.toUpperCase()); }} sx={{ width: 48, height: 40, p: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }} />
                          <TextField fullWidth label="Código HEX" placeholder="#RRGGBB" value={form.fields.colorHex.value} error={Boolean(errors.colorHex) || colorError === 'HEX_INVALIDO'} onChange={(e) => { setColorError(null); setColorGuardado(null); setValue('colorHex', e.target.value); }} helperText="Color del dibujo (formato #RRGGBB); se puede editar o elegir con el selector." slotProps={{ htmlInput: { maxLength: 7, spellCheck: false } }} />
                        </Stack>
                        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Box aria-label="Vista previa del color" role="img" data-testid="color-personalizado-muestra" sx={{ width: 48, height: 32, borderRadius: 1, border: '1px solid', borderColor: 'divider', bgcolor: /^#[0-9A-Fa-f]{6}$/.test(form.fields.colorHex.value.trim()) ? form.fields.colorHex.value.trim() : 'transparent', flexShrink: 0 }} />
                          <Typography variant="body2" data-testid="color-personalizado-vista">{form.fields.colorNombre.value.trim() || 'Sin nombre'} · {form.fields.colorHex.value.trim().toUpperCase() || '—'}</Typography>
                          <Button size="small" variant="outlined" onClick={guardarColor}>Guardar color</Button>
                        </Stack>
                        {colorError && <FormHelperText error data-testid="color-personalizado-error">{CUSTOM_COLOR_ERRORS[colorError]}</FormHelperText>}
                        <Typography variant="caption" color="text.secondary">Los colores personalizados se guardan solo en este navegador y no se comparten entre usuarios.</Typography>
                      </Stack>
                    </FieldFrame>
                  )
                  : <Typography variant="body2" color="text.secondary" data-testid="color-hex-readonly">{colorPreset ? `Color del dibujo: ${form.fields.colorHex.value}` : 'Elige un color para el dibujo.'}</Typography>)}
                {config.colorDibujo && (personalizados.colores.length > 0 || colorGuardado) && (
                  <Box sx={{ gridColumn: '1 / -1' }} data-testid="color-personalizados">
                    {colorGuardado && <Typography variant="caption" color={colorGuardado.persistido ? 'success.main' : 'warning.main'} display="block" data-testid="color-guardado">{colorGuardado.persistido ? `Color «${colorGuardado.nombre}» guardado en este navegador y aplicado a la hoja.` : `Color «${colorGuardado.nombre}» aplicado a la hoja; ${CUSTOM_COLOR_ERRORS.ALMACENAMIENTO}`}</Typography>}
                    {personalizados.colores.length > 0 && (
                      <>
                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Colores personalizados ({personalizados.colores.length}/{CUSTOM_COLORS_MAX}) · solo en este navegador, no se comparten entre usuarios.</Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {personalizados.colores.map((c) => (
                            <Chip key={c.id} size="small" variant="outlined" label={`${c.nombre} ${c.hex}`} avatar={<Box component="span" sx={{ bgcolor: c.hex, border: '1px solid', borderColor: 'divider' }} />} onClick={() => elegirColor(`${PERSONAL}${c.id}`, config)} onDelete={() => personalizados.eliminar(c.id)} deleteIcon={<span aria-label={`Eliminar ${c.nombre} del catálogo local`} role="img">✕</span>} data-testid="color-personalizado-chip" />
                          ))}
                        </Stack>
                      </>
                    )}
                  </Box>
                )}
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

          {!documentos && (
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
          )}
          </>)}
          <Dialog open={familiaPendiente !== null} onClose={() => setFamiliaPendiente(null)} aria-labelledby="cambiar-familia-titulo">
            <DialogTitle id="cambiar-familia-titulo">Cambiar la familia de esta hoja</DialogTitle>
            <DialogContent>
              <Typography>Esta hoja ya está guardada como {configs.find((c) => c.codigo === docActual?.familia)?.nombre ?? docActual?.familia}. Cambiarla a {configs.find((c) => c.codigo === familiaPendiente)?.nombre ?? familiaPendiente} actualizará el borrador guardado: los datos que la nueva familia no usa dejarán de guardarse.</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setFamiliaPendiente(null); setListaFormatos(false); }}>Conservar la familia actual</Button>
              <Button variant="contained" onClick={() => { const nueva = familiaPendiente; setFamiliaPendiente(null); setListaFormatos(false); if (nueva) update((f) => selectFamily(f, nueva, configs)); }}>Cambiar familia</Button>
            </DialogActions>
          </Dialog>
          <Dialog open={reviewWeights && Boolean(config?.pesosCapasRegla)} onClose={() => setReviewWeights(false)} aria-labelledby="review-layer-weights-title">
            <DialogTitle id="review-layer-weights-title">Revisar reemplazo de pesos por capa</DialogTitle>
            <DialogContent>
              <Alert severity="warning">Esta acción reemplaza también los pesos manuales o confirmados. Revisa los valores antes de continuar. No cambia las libras de VCI ni autoriza una especificación oficial.</Alert>
              {config?.pesosCapasRegla?.campos.map((key) => <Typography key={key} sx={{ mt: 1 }}>{FIELD_LABELS[key]}: {form.fields[key].value || 'vacío'} → {suggestLayerWeights(form, true).fields[key].value || 'sin sugerencia'}</Typography>)}
            </DialogContent>
            <DialogActions><Button onClick={() => setReviewWeights(false)}>Cancelar</Button><Button onClick={() => { update((f) => suggestLayerWeights(f, true)); setReviewWeights(false); }}>Reemplazar pesos por sugerencias actuales</Button></DialogActions>
          </Dialog>
        </Box>
        {documentos && (
          <ResponsablesDocumento responsables={responsables} onResponsables={cambiarResponsables} puedeFirmas={puedeFirmas} revisionDatos={(
            <Box sx={{ mt: 2 }}>
              <Button variant="outlined" size="small" disabled={!live?.technicalReady || !currentAssessment?.completo || Boolean(currentAssessment?.bloqueado) || form.familyOrigin !== 'USUARIO' || sinReconocer.length > 0}
                onClick={() => { const confirmed = confirmLayerWeights(form); setForm(confirmed); setReviewedKey(JSON.stringify({ form: confirmed, producto: lookup?.producto })); }}>Confirmar revisión del borrador</Button>
              {reviewed && <Chip size="small" color="success" variant="outlined" sx={{ ml: 1 }} label="Revisión de datos confirmada en pantalla" />}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Confirma la revisión de los datos que ves (por ejemplo, los pesos por capa). No queda registrada, no es la validación del sistema ni un requisito para finalizar; la revisión trazable es «Registrar mi revisión».
              </Typography>
            </Box>
          )} />
        )}
        {documentos && <FinalizarHojaDocumento datos={estadoDatos} bloqueos={bloqueosFinal} faltantes={faltantesFinal.length} contradicciones={sinReconocer.length} onIntentar={() => setIntentoFinal(true)} />}
        </Box>
        </IncidenciasProvider>
        {documentos && docActual?.estado === 'FINALIZADA' && (
          <Box sx={{ minWidth: 0, order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 16 }, mt: 2 }}>
            <Paper variant="outlined" sx={{ p: 2 }} data-testid="hoja-finalizada-panel">
              <Chip size="small" color="success" label={`FINALIZADA · ${etiquetaRevision(docActual)} · PRUEBA`} />
              <Typography sx={{ mt: 1 }}>Esta hoja ya no es un borrador. El documento definitivo es el PDF almacenado ({docActual.pdf?.nombre ?? 'REV'}); descárgalo o ábrelo desde «Hoja finalizada».</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>Los cambios requieren crear una nueva revisión.</Typography>
            </Paper>
          </Box>
        )}
        {!sinElegir && !(documentos && docActual?.estado === 'FINALIZADA') && <Box sx={{ minWidth: 0, order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 16 }, mt: 2 }}>
          <SheetPreviewPanel family={form.family} familyLabel={config?.nombre ?? ''} data={previewData} avisos={avisosVistaPrevia}
            pdfBloqueo={sinReconocer.length > 0 ? `Corrige o reconoce las contradicciones técnicas (${sinReconocer.length}) para descargar el PDF.` : null}
            context={previewContext}
            onAssessment={(result, key, estado) => { setAssessment(result ? { key, result } : null); setFallo(estado === 'error' ? key : ''); }} />
        </Box>}
        </Box>
      )}
    </Box>
  );
  function conResponsables<T extends object | null>(carga: T): T | (T & { responsables: ReturnType<typeof haciaEnvio> }) {
    return carga && respEditados ? { ...carga, responsables: haciaEnvio(responsables) } : carga;
  }
  return documentos ? (
    <DocumentoProvider codigo={busqueda} carga={form && config ? conResponsables(construirCarga(form, config, lookup, reconocidas)) : null} onAbrirDocumento={abrirDocumento} onDocumentoCambio={setDocActual} onDescartado={alDescartar} autoguardar puedeCrear={form?.familyOrigin === 'USUARIO'} ediciones={ediciones} retardoMs={retardoAutoguardado}>
      {contenido}
    </DocumentoProvider>
  ) : contenido;
}

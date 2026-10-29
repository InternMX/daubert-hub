import { Alert, Box, Button, Chip, CircularProgress, Collapse, Paper, Stack, Typography } from '@mui/material';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { FieldKey } from '../services/manufacturingFamilies';
import { anclaDe, estaReconocida, NIVEL_ETIQUETA, ORDEN_NIVEL, resumir, SECCION_ETIQUETA, type Incidencia, type NivelIncidencia, type Reconocimientos, type SeccionIncidencia } from './incidencias';

// Presentación de las incidencias (ver incidencias.ts). Regla: cada causa se muestra UNA vez donde se puede corregir (campo o sección), y el resumen solo la cuenta y permite
// localizarla. Los chips de procedencia (BIND, Code, sugerido, calculado, editado) son otra cosa y no pasan por aquí. Los colores de alerta solo se usan para errores y
// contradicciones; los pendientes se escriben en tono de advertencia y la información, en gris.

// Representadas ya por su propio control (chip «Sugerida por el sistema» + botón «Confirmar familia»; ayuda del campo Cliente): se cuentan en el resumen, pero no se repiten como texto.
const CON_CONTROL_PROPIO = new Set(['FAMILIA_NO_CONFIRMADA', 'CLIENTE_SIN_IDENTIFICAR']);

interface IncidenciasContexto {
  lista: Incidencia[];
  visible: (key: FieldKey) => boolean;
  valores: (key: FieldKey) => string;
  reconocidas: Reconocimientos;
  reconocer: (i: Incidencia) => void;
  deshacer: (i: Incidencia) => void;
  /** Tras pulsar «Validar especificación» también se muestran los datos faltantes en su campo. */
  validado: boolean;
  /** Ids de las incidencias a las que el usuario navegó con «Ir»: su aviso concreto se muestra aunque aún no haya validado. */
  reveladas: ReadonlySet<string>;
  revelar: (id: string) => void;
  /** Estado de la revisión del backend: mientras no hay respuesta vigente no se afirma que no hay incidencias. */
  revision: 'vigente' | 'revisando' | 'no-disponible';
}

const Contexto = createContext<IncidenciasContexto | null>(null);
export function IncidenciasProvider({ value, children }: { value: IncidenciasContexto; children: ReactNode }) {
  return <Contexto.Provider value={value}>{children}</Contexto.Provider>;
}

const useIncidencias = (): IncidenciasContexto | null => useContext(Contexto);

const colorDe = (nivel: NivelIncidencia): 'error' | 'warning.main' | 'text.secondary' => (nivel === 'ERROR' ? 'error' : nivel === 'INFORMACION' ? 'text.secondary' : 'warning.main');

// Los datos faltantes no se marcan en rojo hasta que el usuario valida (el resumen ya los cuenta); un valor no válido sí se señala al escribirlo.
const SE_MUESTRAN_AL_VALIDAR = new Set(['FALTANTE', 'FAMILIA_SIN_ELEGIR']);
const seMuestra = (i: Incidencia, ctx: IncidenciasContexto): boolean => !CON_CONTROL_PROPIO.has(i.codigo) && (!SE_MUESTRAN_AL_VALIDAR.has(i.codigo) || ctx.validado || ctx.reveladas.has(i.id));
const idMensaje = (id: string): string => `incidencia-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

export function MensajeIncidencia({ incidencia, ctx }: { incidencia: Incidencia; ctx: IncidenciasContexto }) {
  const reconocida = estaReconocida(incidencia, ctx.valores, ctx.reconocidas);
  return (
    <Box id={idMensaje(incidencia.id)} data-testid="incidencia" data-incidencia-id={incidencia.id} data-nivel={incidencia.nivel} sx={{ mt: 0.5 }}>
      <Typography variant="caption" display="block" role={incidencia.nivel === 'ERROR' ? 'alert' : undefined} sx={{ color: reconocida ? 'text.secondary' : colorDe(incidencia.nivel) }}>
        {reconocida ? 'Diferencia reconocida para este borrador: ' : ''}{incidencia.mensaje}
      </Typography>
      {incidencia.reconocible && (reconocida
        ? <Button size="small" onClick={() => ctx.deshacer(incidencia)} sx={{ minWidth: 0, p: 0, fontSize: '0.75rem' }}>Quitar reconocimiento</Button>
        : <Button size="small" onClick={() => ctx.reconocer(incidencia)} sx={{ minWidth: 0, p: 0, fontSize: '0.75rem' }}>Reconocer esta diferencia</Button>)}
    </Box>
  );
}

/** Mensajes de las incidencias ancladas a UN campo (se muestran dentro del marco del campo). */
export function IncidenciasDeCampo({ campo }: { campo: FieldKey }) {
  const ctx = useIncidencias();
  if (!ctx) return null;
  const propias = ctx.lista.filter((i) => seMuestra(i, ctx) && (() => { const ancla = anclaDe(i, ctx.visible); return ancla.tipo === 'campo' && ancla.campo === campo; })());
  return <>{propias.map((i) => <MensajeIncidencia key={i.id} incidencia={i} ctx={ctx} />)}</>;
}

/** Incidencias propias de una sección (varios campos, ninguno o un campo que la familia no muestra). Alerta solo para errores y contradicciones. */
export function IncidenciasDeSeccion({ seccion, omitir = [] }: { seccion: SeccionIncidencia; omitir?: string[] }) {
  const ctx = useIncidencias();
  if (!ctx) return null;
  const propias = ctx.lista.filter((i) => seMuestra(i, ctx) && !omitir.includes(i.codigo) && (() => { const ancla = anclaDe(i, ctx.visible); return ancla.tipo === 'seccion' && ancla.seccion === seccion; })());
  if (propias.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 1.5 }} aria-label={`Incidencias de ${SECCION_ETIQUETA[seccion]}`} data-testid={`incidencias-${seccion}`}>
      {propias.map((i) => {
        const reconocida = estaReconocida(i, ctx.valores, ctx.reconocidas);
        return i.nivel === 'ERROR' || (i.nivel === 'CONTRADICCION' && !reconocida)
          ? (
            <Alert key={i.id} id={idMensaje(i.id)} severity={i.nivel === 'ERROR' ? 'error' : 'warning'} variant="outlined" data-testid="incidencia" data-incidencia-id={i.id} data-nivel={i.nivel}
              action={i.reconocible ? <Button size="small" color="inherit" onClick={() => ctx.reconocer(i)}>Reconocer</Button> : undefined}>{i.mensaje}</Alert>
          )
          : <MensajeIncidencia key={i.id} incidencia={i} ctx={ctx} />;
      })}
    </Stack>
  );
}

/** Lleva al usuario al problema: muestra su aviso concreto, desplaza la pantalla, enfoca el control y lo asocia con el mensaje (aria-describedby). */
function localizar(i: Incidencia, ctx: IncidenciasContexto): void {
  ctx.revelar(i.id);
  const ancla = anclaDe(i, ctx.visible);
  const mover = (): void => {
    const destino = ancla.tipo === 'campo'
      ? document.querySelector<HTMLElement>(`[data-field="${ancla.campo}"]`)
      : document.querySelector<HTMLElement>(`section[aria-label="${SECCION_ETIQUETA[ancla.seccion]}"]`);
    destino?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const control = destino?.querySelector<HTMLElement>('input:not([type=hidden]), textarea, [role=combobox], [role=radio]');
    const mensaje = document.getElementById(idMensaje(i.id));
    if (control && mensaje) {
      const previos = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      if (!previos.includes(mensaje.id)) control.setAttribute('aria-describedby', [...previos, mensaje.id].join(' '));
    }
    control?.focus({ preventScroll: true });
  };
  // El aviso se monta tras el siguiente renderizado: se espera a que exista antes de asociarlo y enfocar.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(mover)); else setTimeout(mover, 0);
}

/** Resumen de validación: incidencias ÚNICAS por severidad (sin repetir los mensajes) y botones para localizar el campo o la sección. */
export function ResumenIncidencias({ lista, ctx }: { lista: Incidencia[]; ctx: IncidenciasContexto }) {
  const [abierto, setAbierto] = useState(false);
  const cuenta = resumir(lista, ctx.valores, ctx.reconocidas);
  const pendientesDeRevisar = lista.filter((i) => i.nivel !== 'INFORMACION' && !estaReconocida(i, ctx.valores, ctx.reconocidas)).sort((a, b) => ORDEN_NIVEL[a.nivel] - ORDEN_NIVEL[b.nivel]);
  const chip = (nivel: NivelIncidencia, color: 'error' | 'warning' | 'default') => cuenta[nivel] > 0 && (
    <Chip key={nivel} size="small" color={color} variant={nivel === 'ERROR' || nivel === 'CONTRADICCION' ? 'filled' : 'outlined'} data-testid={`resumen-${nivel}`}
      label={`${cuenta[nivel]} ${cuenta[nivel] === 1 ? NIVEL_ETIQUETA[nivel].singular : NIVEL_ETIQUETA[nivel].plural}`} />
  );
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mt: 2 }} aria-label="Resumen de validación" data-testid="resumen-incidencias">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h2" sx={{ fontSize: '1.125rem' }}>Revisión del borrador</Typography>
        {ctx.revision === 'revisando' && <Chip size="small" variant="outlined" icon={<CircularProgress size={12} />} label="Revisando…" role="status" data-testid="resumen-revisando" />}
        {ctx.revision === 'no-disponible' && <Chip size="small" color="warning" variant="outlined" label="Revisión técnica no disponible" data-testid="resumen-no-disponible" />}
        {cuenta.total === 0 && ctx.revision === 'vigente' && <Chip size="small" color="success" variant="outlined" label="Sin incidencias" data-testid="resumen-vacio" />}
        {chip('ERROR', 'error')}{chip('CONTRADICCION', 'warning')}{chip('PENDIENTE', 'warning')}{chip('INFORMACION', 'default')}
        {cuenta.reconocidas > 0 && <Chip size="small" variant="outlined" label={`${cuenta.reconocidas} reconocida${cuenta.reconocidas === 1 ? '' : 's'}`} data-testid="resumen-reconocidas" />}
        {pendientesDeRevisar.length > 0 && <Button size="small" onClick={() => setAbierto((v) => !v)} sx={{ ml: 'auto' }} aria-expanded={abierto}>{abierto ? 'Ocultar detalle' : 'Ver detalle'}</Button>}
      </Stack>
      <Collapse in={abierto} unmountOnExit>
        <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 1, pl: 0, listStyle: 'none' }}>
          {pendientesDeRevisar.map((i) => (
            <Stack component="li" key={i.id} direction="row" spacing={1} alignItems="baseline" data-testid="resumen-item" data-incidencia-id={i.id}>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, color: colorDe(i.nivel) }}>{i.resumen ?? i.mensaje}</Typography>
              <Button size="small" onClick={() => localizar(i, ctx)} sx={{ minWidth: 0 }} aria-label={`Ir a: ${i.resumen ?? i.mensaje}`}>Ir</Button>
            </Stack>
          ))}
        </Stack>
      </Collapse>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>La revisión solo vale para los valores del borrador actual. No autoriza una especificación oficial. Los pendientes y las informativas no impiden la demostración.</Typography>
    </Paper>
  );
}

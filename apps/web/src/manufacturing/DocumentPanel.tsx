import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import {
  actualizarBorrador, asignarRevisor, cancelarFinalizacion, crearBorrador, crearRevisionNueva, descargarPdfFinalizado, descartarBorrador, DocumentApiError, documentErrorText, finalizarDocumento,
  listarRevisores, obtenerDocumento, registrarRevision, type DocumentoVista, type MotivoNoLista, type UsuarioRevisor
} from '../services/manufacturingDocuments';
import { claveDeCarga, claveDeDocumento, type CargaDocumento } from './documentSpec';
import { etiquetaRevision } from './documentLabels';
import { DocumentHistoryDialog } from './DocumentHistoryDialog';
import { guardarArchivo } from './downloadFile';

// Gestor documental (TEST) dentro de la especificación de manufactura. No edita la hoja: guarda lo que el usuario ya ve (la carga que arma el formulario) y administra el ciclo del documento.
// Toda identidad (quién elaboró, modificó, revisó, finalizó) la pone el servidor desde la sesión: este panel nunca la envía.

interface Props {
  /** Código DCMX del producto abierto (null si todavía no hay producto). */
  codigo: string | null;
  /** Lo que se guardaría ahora (null si falta elegir familia). */
  carga: CargaDocumento | null;
  /** Se invoca al abrir un documento guardado para que el formulario lo muestre. */
  onAbrirDocumento: (doc: DocumentoVista) => void;
}

type Aviso = { tipo: 'success' | 'error' | 'info' | 'warning'; texto: string };

export function DocumentPanel({ codigo, carga, onAbrirDocumento }: Props) {
  const [doc, setDoc] = useState<DocumentoVista | null>(null);
  const [variante, setVariante] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [motivos, setMotivos] = useState<MotivoNoLista[]>([]);
  const [revisores, setRevisores] = useState<UsuarioRevisor[]>([]);
  const [revisorSel, setRevisorSel] = useState('');
  const [elaboro, setElaboro] = useState('');
  const [autorizo, setAutorizo] = useState('');
  const [historial, setHistorial] = useState(false);
  const [confirmando, setConfirmando] = useState<'finalizar' | 'descartar' | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const montado = useRef(true);
  const solicitud = useRef(0);
  useEffect(() => () => { montado.current = false; }, []);

  // Un documento abierto pertenece a su código: si el usuario busca otro producto, el panel vuelve a «sin guardar».
  useEffect(() => { if (doc && codigo !== null && doc.codigo.toLowerCase() !== codigo.toLowerCase()) { setDoc(null); setAviso(null); setMotivos([]); } }, [codigo, doc]);
  useEffect(() => { if (doc) { setElaboro(doc.elaboro.nombre ?? doc.elaboro.sugerido); setAutorizo(doc.autorizo ?? ''); setRevisorSel(doc.revisor?.id ?? ''); } }, [doc]);
  useEffect(() => {
    if (!doc || doc.estado !== 'BORRADOR' || !doc.permisos.asignarRevisor) return undefined;
    const c = new AbortController();
    listarRevisores(c.signal).then((r) => { if (montado.current) setRevisores(r.data); }).catch(() => undefined);
    return () => c.abort();
  }, [doc?.id, doc?.estado, doc?.permisos.asignarRevisor]); // eslint-disable-line react-hooks/exhaustive-deps

  const abierto = doc !== null && (doc.estado === 'BORRADOR' || doc.estado === 'FINALIZANDO');
  const sucio = doc ? doc.estado === 'BORRADOR' && claveDeCarga(carga) !== claveDeDocumento(doc) : carga !== null;

  /** Ejecuta una acción del servidor: bloquea los botones, muestra el resultado y traduce los errores (sin mostrar nunca el cuerpo crudo de la respuesta). */
  async function ejecutar(accion: () => Promise<DocumentoVista | void>, exito?: (d: DocumentoVista | void) => Aviso | null, abrir = false): Promise<void> {
    // Solo la solicitud MÁS RECIENTE puede reemplazar el documento abierto: una respuesta tardía de una solicitud anterior se descarta (no cambia el panel ni el formulario).
    const mia = ++solicitud.current;
    setOcupado(true); setAviso(null); setMotivos([]); setConflicto(false);
    try {
      const r = await accion();
      if (!montado.current || mia !== solicitud.current) return;
      if (r) { setDoc(r); if (abrir) onAbrirDocumento(r); }
      setAviso(exito ? exito(r) : null);
    } catch (e) {
      if (!montado.current || mia !== solicitud.current) return;
      if (e instanceof DocumentApiError) {
        setMotivos(e.motivos);
        setConflicto(e.kind === 'VERSION_CONFLICT');
        const extra = e.kind === 'CLIENTE_ACTUALIZADO' && e.nombreActual ? ` Nombre vigente: «${e.nombreActual}».` : '';
        setAviso({ tipo: 'error', texto: documentErrorText[e.kind] + extra });
      } else setAviso({ tipo: 'error', texto: documentErrorText.NETWORK });
    } finally { if (montado.current && mia === solicitud.current) { setOcupado(false); setConfirmando(null); } }
  }

  const guardar = (): Promise<void> => {
    if (!carga || !codigo) return Promise.resolve();
    if (!doc) return ejecutar(() => crearBorrador({ codigo, ...(variante.trim() ? { variante: variante.trim() } : {}), ...carga }), () => ({ tipo: 'success', texto: 'Borrador guardado.' }));
    return ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, ...carga }), () => ({ tipo: 'success', texto: 'Cambios guardados.' }));
  };
  const recargar = (): Promise<void> => (doc ? ejecutar(() => obtenerDocumento(doc.id), () => ({ tipo: 'info', texto: 'Se cargó la versión vigente del servidor.' }), true) : Promise.resolve());
  const abrirPorId = (id: string): Promise<void> => ejecutar(() => obtenerDocumento(id), (d) => ({ tipo: 'info', texto: `Documento abierto: ${d ? `${d.codigo} · ${etiquetaRevision(d)}` : ''}` }), true).then(() => setHistorial(false));
  const descargar = (): Promise<void> => (doc ? ejecutar(async () => { const p = await descargarPdfFinalizado(doc.id); guardarArchivo(p.blob, p.filename); }, () => ({ tipo: 'success', texto: 'PDF descargado.' })) : Promise.resolve());

  const confirmarElaboro = (): Promise<void> => (doc ? ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, elaboroNombre: elaboro, elaboroConfirmado: true }), () => ({ tipo: 'success', texto: 'Elaboró confirmado.' })) : Promise.resolve());
  const guardarAutorizo = (): Promise<void> => (doc ? ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, autorizoNombre: autorizo }), () => ({ tipo: 'success', texto: 'Autorizó actualizado (opcional; no hay flujo de autorización).' })) : Promise.resolve());
  const asignar = (): Promise<void> => (doc ? ejecutar(() => asignarRevisor(doc.id, doc.version, revisorSel === '' ? null : revisorSel), () => ({ tipo: 'success', texto: revisorSel === '' ? 'Revisor retirado.' : 'Revisor asignado.' })) : Promise.resolve());

  const vigentes = doc?.confirmaciones.filter((k) => k.vigente) ?? [];
  const obsoletas = (doc?.confirmaciones.length ?? 0) - vigentes.length;
  const elaboroCambiado = doc ? (elaboro.trim() || null) !== doc.elaboro.nombre : false;

  return (
    <Paper component="section" aria-labelledby="gestor-doc-titulo" sx={{ p: 2, mt: 2 }} data-testid="document-panel">
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
        <Typography id="gestor-doc-titulo" variant="h6" component="h2">Documento</Typography>
        <Chip size="small" color="warning" label="PRUEBA · NO VÁLIDO PARA PRODUCCIÓN" />
        {doc ? <Chip size="small" color={doc.estado === 'FINALIZADA' ? 'success' : 'default'} label={`${doc.codigo}${doc.variante ? ` · ${doc.variante}` : ''} · ${etiquetaRevision(doc)} · v${doc.version}`} /> : <Chip size="small" variant="outlined" label="Sin guardar" />}
        {doc?.cliente && !doc.cliente.verificado && <Chip size="small" color="warning" variant="outlined" label="Cliente sin verificar (manual de TEST)" />}
        {sucio && doc?.estado === 'BORRADOR' && <Chip size="small" color="info" label="Cambios sin guardar" />}
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<HistoryRoundedIcon />} onClick={() => setHistorial(true)}>Mis borradores e historial</Button>
      </Stack>

      {aviso && <Alert severity={aviso.tipo} sx={{ mb: 1 }} role={aviso.tipo === 'error' ? 'alert' : 'status'}>{aviso.texto}</Alert>}
      {conflicto && <Button size="small" sx={{ mb: 1 }} onClick={() => void recargar()} disabled={ocupado}>Recargar la versión vigente (reemplaza lo que ves en pantalla)</Button>}
      {motivos.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }} aria-label="Requisitos pendientes">
          <b>Requisitos pendientes:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{motivos.map((m) => <li key={m.codigo}>{m.mensaje}{m.detalle && m.detalle.length > 0 ? ` (${m.detalle.join('; ')})` : ''}</li>)}</ul>
        </Alert>
      )}

      {/* ---------------------------------------------------------------- guardar / actualizar */}
      {(!doc || doc.estado === 'BORRADOR') && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
          {!doc && <TextField size="small" label="Variante (opcional)" value={variante} onChange={(e) => setVariante(e.target.value)} helperText="Ej.: Doblada, Extendida. Un código puede tener varias hojas." sx={{ minWidth: 220 }} />}
          <Button variant="contained" onClick={() => void guardar()} disabled={ocupado || !carga || !codigo || (Boolean(doc) && !sucio) || (doc ? !doc.permisos.editar : false)}>
            {ocupado ? <CircularProgress size={18} /> : doc ? 'Guardar cambios' : 'Guardar borrador'}
          </Button>
          {!carga && <Typography variant="body2" color="text.secondary">Elige la familia para poder guardar.</Typography>}
          {doc && !doc.permisos.editar && <Typography variant="body2" color="text.secondary">Solo el creador o un administrador pueden modificar este borrador.</Typography>}
        </Stack>
      )}

      {/* ---------------------------------------------------------------- responsables y revisión (borrador) */}
      {doc?.estado === 'BORRADOR' && (
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="subtitle2" component="h3">Elaboró (impreso en el documento)</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <TextField size="small" label="Elaboró" value={elaboro} onChange={(e) => setElaboro(e.target.value)} disabled={!doc.permisos.editar} helperText={`Sugerido desde tu cuenta: ${doc.elaboro.sugerido}. Puedes editarlo; debe confirmarse expresamente.`} sx={{ minWidth: 280 }} />
              {doc.elaboro.confirmado && !elaboroCambiado ? <Chip size="small" color="success" label="Elaboró confirmado" /> : <Button variant="outlined" size="small" onClick={() => void confirmarElaboro()} disabled={ocupado || !doc.permisos.editar || !elaboro.trim()}>Confirmar «Elaboró»</Button>}
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h3">Autorizó (opcional)</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <TextField size="small" label="Autorizó" value={autorizo} onChange={(e) => setAutorizo(e.target.value)} disabled={!doc.permisos.editar} helperText="Solo un nombre impreso: no hay flujo de autorización ni firma." sx={{ minWidth: 280 }} />
              <Button variant="outlined" size="small" onClick={() => void guardarAutorizo()} disabled={ocupado || !doc.permisos.editar || (autorizo.trim() || null) === doc.autorizo}>Guardar Autorizó</Button>
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h3">Revisión (opcional)</Typography>
            {doc.permisos.asignarRevisor && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                <TextField select size="small" label="Revisor asignado" value={revisorSel} onChange={(e) => setRevisorSel(e.target.value)} sx={{ minWidth: 280 }}>
                  <MenuItem value=""><em>Sin revisor</em></MenuItem>
                  {revisores.map((u) => <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>)}
                </TextField>
                <Button variant="outlined" size="small" onClick={() => void asignar()} disabled={ocupado || revisorSel === (doc.revisor?.id ?? '')}>Asignar revisor</Button>
              </Stack>
            )}
            {!doc.permisos.asignarRevisor && <Typography variant="body2">Revisor asignado: {doc.revisor?.nombre ?? 'ninguno'}</Typography>}
            <Box sx={{ mt: 1 }}>
              <Button variant="outlined" size="small" onClick={() => void ejecutar(() => registrarRevision(doc.id, doc.version), () => ({ tipo: 'success', texto: 'Tu revisión quedó registrada sobre esta versión.' }))}
                disabled={ocupado || sucio || !doc.permisos.registrarRevision} aria-describedby="revision-ayuda">Registrar mi revisión</Button>
              <Typography id="revision-ayuda" variant="caption" display="block" color="text.secondary">
                {sucio ? 'Guarda los cambios antes de revisar: la revisión se liga a la versión guardada. ' : ''}La registra tu cuenta (no se escribe ningún nombre) y pierde vigencia si cambia algo técnico. {doc.confirmaciones.some((k) => k.autorrevision) ? 'Hay una autorrevisión: queda constancia.' : ''}
              </Typography>
              {vigentes.map((k) => <Chip key={`${k.usuario}-${k.registradaEn}`} size="small" color="success" sx={{ mr: 0.5, mt: 0.5 }} label={`Revisó: ${k.usuario}${k.autorrevision && !k.comoRevisorAsignado ? ' (autorrevisión)' : ''}`} />)}
              {obsoletas > 0 && <Chip size="small" variant="outlined" sx={{ mt: 0.5 }} label={`${obsoletas} revisión(es) sin vigencia por cambios técnicos`} />}
            </Box>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" color="success" disabled={ocupado || sucio || !doc.permisos.finalizar} onClick={() => setConfirmando('finalizar')} aria-describedby="finalizar-ayuda">Finalizar hoja</Button>
            <Button color="inherit" disabled={ocupado || !doc.permisos.editar} onClick={() => setConfirmando('descartar')}>Descartar borrador</Button>
          </Stack>
          <Typography id="finalizar-ayuda" variant="caption" color="text.secondary">
            {sucio ? 'Guarda los cambios antes de finalizar: el PDF se genera desde la copia guardada. ' : ''}Requiere «Elaboró» confirmado, cliente identificado, hoja completa y contradicciones reconocidas. Genera el PDF de PRUEBA y fija la revisión.
          </Typography>
        </Stack>
      )}

      {doc?.estado === 'FINALIZANDO' && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Hay una finalización en curso ({etiquetaRevision(doc)}). El contenido está congelado.
          {doc.permisos.finalizar && <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => void ejecutar(() => cancelarFinalizacion(doc.id, doc.version), () => ({ tipo: 'info', texto: 'Finalización cancelada: vuelve a ser borrador.' }))} disabled={ocupado}>Cancelar finalización</Button>
            <Button size="small" onClick={() => void ejecutar(() => finalizarDocumento(doc.id, doc.version), () => ({ tipo: 'success', texto: 'Hoja finalizada.' }))} disabled={ocupado}>Reintentar (si pasaron más de 10 min)</Button>
          </Box>}
        </Alert>
      )}

      {/* ---------------------------------------------------------------- versión finalizada */}
      {doc?.estado === 'FINALIZADA' && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Alert severity="success">
            Finalizada en TEST como <b>{etiquetaRevision(doc)}</b> por {doc.finalizadoPor ?? '—'}. Elaboró: {doc.elaboro.nombre}. {doc.confirmaciones.some((k) => k.vigente) ? `Revisó: ${doc.confirmaciones.filter((k) => k.vigente).map((k) => k.usuario).join(', ')}.` : 'Sin revisión registrada.'} Las versiones finalizadas no se modifican.
          </Alert>
          {doc.pdf && <Typography variant="caption" color="text.secondary">Archivo: {doc.pdf.nombre} · SHA-256 {doc.pdf.sha256.slice(0, 16)}…</Typography>}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={ocupado ? <CircularProgress size={16} /> : <PictureAsPdfRoundedIcon />} onClick={() => void descargar()} disabled={ocupado || !doc.permisos.descargarPdf}>Descargar PDF finalizado</Button>
            <Button variant="outlined" onClick={() => void ejecutar(() => crearRevisionNueva(doc.documentoId), () => ({ tipo: 'success', texto: 'Nueva revisión creada como borrador a partir de la última versión finalizada.' }), true)} disabled={ocupado || !doc.permisos.crearRevisionNueva}>Crear nueva revisión</Button>
          </Stack>
          {!doc.permisos.crearRevisionNueva && <Typography variant="caption" color="text.secondary">Solo el creador del documento o un administrador pueden crear una nueva revisión.</Typography>}
        </Stack>
      )}
      {doc?.estado === 'DESCARTADA' && <Alert severity="info" sx={{ mt: 1 }}>Este borrador fue descartado.</Alert>}
      {!abierto && doc === null && !carga && <Typography variant="body2" color="text.secondary">Busca un producto y elige la familia para guardar la hoja como borrador.</Typography>}

      <Dialog open={confirmando === 'finalizar'} onClose={() => setConfirmando(null)} aria-labelledby="fin-titulo">
        <DialogTitle id="fin-titulo">Finalizar la hoja</DialogTitle>
        <DialogContent>
          <Typography>Se generará el PDF de PRUEBA desde la copia guardada (versión {doc?.version}) y se registrará como revisión definitiva. Después no podrá modificarse; los cambios requerirán una nueva revisión.</Typography>
          <Typography sx={{ mt: 1 }} variant="body2" color="text.secondary">Lo imprimirá como «PRUEBA · NO VÁLIDO PARA PRODUCCIÓN», sin firmas.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(null)}>Cancelar</Button>
          <Button variant="contained" color="success" disabled={ocupado} onClick={() => doc && void ejecutar(() => finalizarDocumento(doc.id, doc.version), () => ({ tipo: 'success', texto: 'Hoja finalizada. El PDF quedó almacenado.' }))}>Finalizar</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmando === 'descartar'} onClose={() => setConfirmando(null)} aria-labelledby="desc-titulo">
        <DialogTitle id="desc-titulo">Descartar el borrador</DialogTitle>
        <DialogContent><Typography>El borrador quedará descartado y no podrá recuperarse. Podrás guardar un borrador nuevo con el mismo código y variante cuando lo necesites.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(null)}>Cancelar</Button>
          <Button color="error" disabled={ocupado} onClick={() => doc && void ejecutar(() => descartarBorrador(doc.id, doc.version), () => ({ tipo: 'info', texto: 'Borrador descartado.' }))}>Descartar</Button>
        </DialogActions>
      </Dialog>
      <DocumentHistoryDialog abierto={historial} codigoInicial={codigo ?? ''} onClose={() => setHistorial(false)} onAbrir={(id) => void abrirPorId(id)} />
    </Paper>
  );
}

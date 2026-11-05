import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  actualizarBorrador, asignarRevisor, cancelarFinalizacion, crearBorrador, crearRevisionNueva, descargarPdfFinalizado, descartarBorrador, DocumentApiError, documentErrorText, finalizarDocumento, FUNCIONES,
  listarRevisores, obtenerDocumento, registrarRevision, type DocumentoVista, type MotivoNoLista, type UsuarioRevisor
} from '../services/manufacturingDocuments';
import { Contexto, useDocumento, type Aviso, type Documento, type EstadoGuardado } from './documentoContexto';
import { claveDeCarga, claveDeDocumento, type CargaDocumento } from './documentSpec';
import { etiquetaRevision } from './documentLabels';
import { DocumentHistoryDialog } from './DocumentHistoryDialog';
import { ResponsablesFirmas } from './ResponsablesFirmas';
import type { ResponsableLocal } from './responsablesModelo';
import { guardarArchivo } from './downloadFile';

// Gestor documental (TEST) integrado en la hoja de manufactura. NO edita la hoja: guarda lo que el usuario ya ve (la carga que arma el formulario) y administra el ciclo del documento.
// Toda identidad (quién elaboró, modificó, revisó, finalizó) la pone el servidor desde la sesión: estos componentes nunca la envían.
//
// El estado vive en `DocumentoProvider` y se presenta en dos lugares del MISMO formulario: `BarraDocumento` (estado + acciones contextuales: guardar, finalizar, PDF, nueva revisión,
// historial) y `ResponsablesDocumento` («Elaboró», «Autorizó», revisor y revisión). `DocumentPanel` los compone juntos.

interface ProviderProps {
  /** Código DCMX con el que se trabaja (null si todavía no hay búsqueda). Un documento abierto pertenece a su código. */
  codigo: string | null;
  /** Lo que se guardaría ahora (null si falta elegir familia o no hay formulario). */
  carga: CargaDocumento | null;
  /** Se invoca al abrir un documento guardado para que el formulario lo muestre. */
  onAbrirDocumento: (doc: DocumentoVista) => void;
  /** Informa a la página del documento vigente (estado y permisos), para que el formulario se ponga en solo lectura cuando corresponda. */
  onDocumentoCambio?: (doc: DocumentoVista | null) => void;
  /** Se invoca cuando el borrador se descartó con éxito: la página cierra el formulario y vuelve a la búsqueda del código. */
  onDescartado?: (doc: DocumentoVista) => void;
  /** Guardado automático de borradores (sin botón «Guardar»). Apagado por defecto. */
  autoguardar?: boolean;
  /** Datos mínimos conocidos para CREAR el borrador (familia confirmada por el usuario). Nunca se inventan valores técnicos. */
  puedeCrear?: boolean;
  /** Contador de ediciones del usuario: distingue lo que escribió de lo que el formulario normaliza al abrir (abrir no guarda ni crea versiones). */
  ediciones?: number;
  /** Retardo del debounce en ms (una petición por pausa de escritura, no por tecla). */
  retardoMs?: number;
  children?: ReactNode;
}

export function DocumentoProvider({ codigo, carga, onAbrirDocumento, onDocumentoCambio, onDescartado, autoguardar = false, puedeCrear = false, ediciones = 0, retardoMs = 1500, children }: ProviderProps) {
  const [docServidor, setDoc] = useState<DocumentoVista | null>(null);
  // Consulta compartida: un borrador AJENO se abre siempre en solo lectura (aunque el servidor permita editarlo a un ADMIN). La edición de un ADMIN exige la acción explícita «Editar como administrador»
  // y vale solo para ESE documento; abrirlo no guarda nada (sin permiso de edición no hay autoguardado).
  const [edicionAdminDe, setEdicionAdminDe] = useState<string | null>(null);
  const doc = useMemo<DocumentoVista | null>(() => {
    if (!docServidor || docServidor.propio || docServidor.estado !== 'BORRADOR' || edicionAdminDe === docServidor.id) return docServidor;
    return { ...docServidor, permisos: { ...docServidor.permisos, editar: false, finalizar: false, asignarRevisor: false, registrarRevision: docServidor.asignadoComoRevisor && docServidor.permisos.registrarRevision } };
  }, [docServidor, edicionAdminDe]);
  const soloConsulta = docServidor !== null && !docServidor.propio && ((docServidor.estado === 'BORRADOR' && edicionAdminDe !== docServidor.id) || (docServidor.estado === 'FINALIZANDO' && !docServidor.permisos.finalizar));
  const puedeEditarComoAdmin = docServidor !== null && !docServidor.propio && docServidor.estado === 'BORRADOR' && docServidor.permisos.editar && edicionAdminDe !== docServidor.id;
  const [variante, setVariante] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [motivos, setMotivos] = useState<MotivoNoLista[]>([]);
  const [revisores, setRevisores] = useState<UsuarioRevisor[]>([]);
  const [revisorSel, setRevisorSel] = useState('');
  const [elaboro, setElaboro] = useState('');
  const [autorizo, setAutorizo] = useState('');
  const [historial, setHistorial] = useState<{ abierto: boolean; codigo: string }>({ abierto: false, codigo: '' });
  const [confirmando, setConfirmando] = useState<'finalizar' | 'descartar' | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [errorFin, setErrorFin] = useState<{ texto: string; motivos: MotivoNoLista[] } | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const finalizandoRef = useRef(false);
  const montado = useRef(true);
  const solicitud = useRef(0);
  // StrictMode (desarrollo) monta, desmonta y vuelve a montar: la marca debe volver a `true` al re-montar o las respuestas se descartan y el indicador de carga queda activo.
  useEffect(() => { montado.current = true; return () => { montado.current = false; }; }, []);

  // Un documento abierto pertenece a su código: si el usuario busca otro producto, el panel vuelve a «sin guardar».
  useEffect(() => { if (doc && codigo !== null && doc.codigo.toLowerCase() !== codigo.toLowerCase()) { setDoc(null); setAviso(null); setMotivos([]); } }, [codigo, doc]);
  useEffect(() => { onDocumentoCambio?.(doc); }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setErrorFin(null); setErrorDescarga(null); }, [doc?.id]);
  useEffect(() => { if (doc) { setElaboro(doc.elaboro.nombre ?? doc.elaboro.sugerido); setAutorizo(doc.autorizo ?? ''); setRevisorSel(doc.revisor?.id ?? ''); } }, [doc]);
  useEffect(() => {
    if (!doc || doc.estado !== 'BORRADOR' || !doc.permisos.asignarRevisor) return undefined;
    const c = new AbortController();
    listarRevisores(c.signal).then((r) => { if (montado.current) setRevisores(r.data); }).catch(() => undefined);
    return () => c.abort();
  }, [doc?.id, doc?.estado, doc?.permisos.asignarRevisor]); // eslint-disable-line react-hooks/exhaustive-deps

  const sucio = doc ? doc.estado === 'BORRADOR' && claveDeCarga(carga) !== claveDeDocumento(doc, carga?.responsables !== undefined) : carga !== null;

  // ---------------------------------------------------------------- guardado automático de borradores
  // Reglas: no se crea nada por buscar ni por consultar BIND; el borrador se crea una sola vez cuando el usuario ya confirmó la familia (datos mínimos de la base; no se inventa ningún valor);
  // los cambios posteriores se guardan con debounce usando el control de versiones (409 = conflicto, nunca se sobrescribe); «guardado» solo se muestra tras la respuesta del servidor; una
  // respuesta tardía de otro documento se descarta; no se confirma «Elaboró», revisiones ni firmas.
  const [guardado, setGuardado] = useState<EstadoGuardado>('inactivo');
  const [guardadoEn, setGuardadoEn] = useState<Date | null>(null);
  const [autoOcupado, setAutoOcupado] = useState(false);
  const [baseEd, setBaseEd] = useState(ediciones);
  const [errorEd, setErrorEd] = useState(-1);
  const [creacionIntentada, setCreacionIntentada] = useState(false);
  const [varianteFallida, setVarianteFallida] = useState<string | null>(null);
  const espejo = useRef({ doc, carga, codigo, variante, ediciones, baseEd, puedeCrear });
  useEffect(() => { espejo.current = { doc, carga, codigo, variante, ediciones, baseEd, puedeCrear }; });
  const enVuelo = useRef<Promise<unknown> | null>(null);
  const gen = useRef(0);
  const descartando = useRef(false);   // mientras se descarta no se inicia ningún guardado (el automático pendiente queda anulado)

  const errorSinNuevasEdiciones = guardado === 'error' && ediciones <= errorEd;
  const elegible = autoguardar && carga !== null && guardado !== 'conflicto' && !errorSinNuevasEdiciones && (doc
    ? doc.estado === 'BORRADOR' && doc.permisos.editar && sucio && ediciones > baseEd
    : puedeCrear && (!creacionIntentada || (guardado === 'existe' && variante.trim() !== varianteFallida)));
  const pendiente = elegible && guardado !== 'guardando';
  const riesgo = autoguardar && carga !== null && (guardado === 'guardando' || guardado === 'error' || guardado === 'conflicto' || pendiente || (!doc && ediciones > baseEd));
  const riesgoRef = useRef(false);
  useEffect(() => { riesgoRef.current = riesgo; });

  /** Guarda (crea o actualiza). Las llamadas se encadenan: nunca hay dos peticiones de guardado a la vez. Devuelve `ok` y el documento vigente. */
  function guardarAuto(forzar: boolean): Promise<{ ok: boolean; doc: DocumentoVista | null }> {
    const previo = enVuelo.current;
    const trabajo = (async (): Promise<{ ok: boolean; doc: DocumentoVista | null }> => {
      if (previo) await previo.catch(() => undefined);
      if (descartando.current) return { ok: false, doc: espejo.current.doc };
      const e = espejo.current;
      const g = gen.current;
      const d = e.doc;
      if (!e.carga || !e.codigo) return { ok: true, doc: d };
      if (d) {
        if (d.estado !== 'BORRADOR' || !d.permisos.editar) return { ok: true, doc: d };
        if (claveDeCarga(e.carga) === claveDeDocumento(d, e.carga.responsables !== undefined)) return { ok: true, doc: d };
        if (!forzar && e.ediciones <= e.baseEd) return { ok: true, doc: d };
      } else if (!forzar && !e.puedeCrear) return { ok: true, doc: null };
      const snapEd = e.ediciones;
      setGuardado('guardando'); setAutoOcupado(true);
      if (!d) setCreacionIntentada(true);
      try {
        const r = d
          ? await actualizarBorrador(d.id, { version: d.version, ...e.carga })
          : await crearBorrador({ codigo: e.codigo, ...(e.variante.trim() ? { variante: e.variante.trim() } : {}), ...e.carga });
        if (!montado.current || g !== gen.current) return { ok: false, doc: d };      // respuesta tardía de otro documento: se ignora
        setDoc(r); setBaseEd(snapEd); setGuardado('guardado'); setGuardadoEn(new Date()); setAviso(null); setConflicto(false);
        return { ok: true, doc: r };
      } catch (error) {
        if (!montado.current || g !== gen.current) return { ok: false, doc: d };
        const tipo = error instanceof DocumentApiError ? error.kind : 'NETWORK';
        setErrorEd(snapEd);
        if (tipo === 'VERSION_CONFLICT') { setGuardado('conflicto'); setConflicto(true); }
        else if (tipo === 'DOCUMENT_EXISTS' && !d) { setGuardado('existe'); setVarianteFallida(e.variante.trim()); }
        else { setGuardado('error'); if (!d) setCreacionIntentada(false); }
        const campos = error instanceof DocumentApiError ? error.campos : [];
        setAviso({ tipo: 'error', texto: documentErrorText[tipo] + (tipo === 'INVALID_DATA' && campos.length > 0 ? ` Revisa: ${campos.map((c) => c.replace(/^datos\./, '')).join(', ')}.` : '') });
        return { ok: false, doc: d };
      } finally { if (montado.current && g === gen.current) setAutoOcupado(false); }
    })();
    enVuelo.current = trabajo;
    void trabajo.finally(() => { if (enVuelo.current === trabajo) enVuelo.current = null; });
    return trabajo;
  }

  const claveCarga = claveDeCarga(carga);
  useEffect(() => {
    if (!elegible || guardado === 'guardando') return undefined;
    const t = setTimeout(() => { void guardarAuto(false); }, retardoMs);
    return () => clearTimeout(t);
  }, [elegible, claveCarga, ediciones, guardado, doc?.version, variante]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cambios sin persistir: se advierte al cerrar/recargar la página y se intenta guardar al ocultarla o al salir de la pantalla.
  useEffect(() => {
    if (!riesgo) return undefined;
    const advertir = (ev: BeforeUnloadEvent): void => { ev.preventDefault(); ev.returnValue = ''; };
    const oculto = (): void => { if (document.visibilityState === 'hidden') void guardarAuto(false); };
    window.addEventListener('beforeunload', advertir);
    document.addEventListener('visibilitychange', oculto);
    return () => { window.removeEventListener('beforeunload', advertir); document.removeEventListener('visibilitychange', oculto); };
  }, [riesgo]);  
  useEffect(() => () => { if (riesgoRef.current) void guardarAuto(false); }, []);  
  /** Tras abrir otro documento: nueva línea base (abrir no guarda) y cualquier respuesta de guardado del documento anterior queda obsoleta. */
  const reiniciarBase = (): void => { gen.current += 1; setBaseEd(espejo.current.ediciones); setErrorEd(-1); setGuardado('inactivo'); setCreacionIntentada(false); setVarianteFallida(null); setAutoOcupado(false); };

  function reportarError(e: unknown): { texto: string; motivos: MotivoNoLista[] } {
    if (e instanceof DocumentApiError) {
      setMotivos(e.motivos);
      setConflicto(e.kind === 'VERSION_CONFLICT');
      const extra = e.kind === 'CLIENTE_ACTUALIZADO' && e.nombreActual ? ` Nombre vigente: «${e.nombreActual}».` : e.kind === 'INVALID_DATA' && e.campos.length > 0 ? ` Revisa: ${e.campos.map((c) => c.replace(/^datos\./, '')).join(', ')}.` : '';
      setAviso({ tipo: 'error', texto: documentErrorText[e.kind] + extra });
      return { texto: documentErrorText[e.kind] + extra, motivos: e.motivos };
    }
    setAviso({ tipo: 'error', texto: documentErrorText.NETWORK });
    return { texto: documentErrorText.NETWORK, motivos: [] };
  }

  /** Ejecuta una acción del servidor: bloquea los botones, muestra el resultado y traduce los errores (sin mostrar nunca el cuerpo crudo de la respuesta). */
  async function ejecutar(accion: () => Promise<DocumentoVista | void>, exito?: (d: DocumentoVista | void) => Aviso | null, abrir = false): Promise<void> {
    // Solo la solicitud MÁS RECIENTE puede reemplazar el documento abierto: una respuesta tardía de una solicitud anterior se descarta (no cambia el panel ni el formulario).
    const mia = ++solicitud.current;
    setOcupado(true); setAviso(null); setMotivos([]); setConflicto(false);
    try {
      const r = await accion();
      if (!montado.current || mia !== solicitud.current) return;
      if (r) { setDoc(r); if (abrir) { onAbrirDocumento(r); reiniciarBase(); } }
      setAviso(exito ? exito(r) : null);
    } catch (e) {
      if (!montado.current || mia !== solicitud.current) return;
      reportarError(e);
    } finally { if (montado.current && mia === solicitud.current) { setOcupado(false); setConfirmando(null); } }
  }

  const guardar = (): Promise<void> => {
    if (!carga || !codigo) return Promise.resolve();
    if (!doc) return ejecutar(() => crearBorrador({ codigo, ...(variante.trim() ? { variante: variante.trim() } : {}), ...carga }), () => ({ tipo: 'success', texto: 'Borrador guardado.' }));
    return ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, ...carga }), () => ({ tipo: 'success', texto: 'Cambios guardados.' }));
  };
  const recargar = (): Promise<void> => (doc ? ejecutar(() => obtenerDocumento(doc.id), () => ({ tipo: 'info', texto: 'Se cargó la versión vigente del servidor.' }), true) : Promise.resolve());
  const abrirPorId = async (id: string): Promise<void> => {
    // Con guardado automático, los cambios pendientes se guardan antes de abrir otra hoja; si no se pueden guardar, no se abre (no se pierde nada).
    if (autoguardar && riesgoRef.current) {
      const r = await guardarAuto(false);
      if (!r.ok) { setAviso({ tipo: 'error', texto: 'No se pudieron guardar los cambios de la hoja abierta; no se abrió otra para no perderlos.' }); return; }
    }
    await ejecutar(() => obtenerDocumento(id), (d) => ({ tipo: 'info', texto: `Documento abierto: ${d ? `${d.codigo} · ${etiquetaRevision(d)}` : ''}` }), true);
    setHistorial((h) => ({ ...h, abierto: false }));
  };
  // Descargar siempre entrega el PDF ALMACENADO (el servidor verifica su SHA-256); nunca se vuelve a generar. Un fallo aquí no es un fallo de finalización: tiene su propio mensaje.
  const textoDescarga = (e: unknown): string => `No se pudo descargar el PDF almacenado. ${e instanceof DocumentApiError ? documentErrorText[e.kind] : documentErrorText.NETWORK} La hoja sigue finalizada; puedes intentarlo de nuevo.`;
  const descargarPorId = (id: string): Promise<void> => {
    setErrorDescarga(null);
    return ejecutar(async () => {
      try { const p = await descargarPdfFinalizado(id); guardarArchivo(p.blob, p.filename); } catch (e) { setErrorDescarga(textoDescarga(e)); throw e; }
    }, () => ({ tipo: 'success', texto: 'PDF descargado.' }));
  };
  const verFinalizada = async (): Promise<void> => {
    if (!doc || doc.estado !== 'FINALIZADA') return;
    setErrorDescarga(null); setOcupado(true);
    const pestana = window.open('', '_blank');                                // se abre al hacer clic (antes de esperar) para que el navegador no la bloquee
    try {
      const p = await descargarPdfFinalizado(doc.id);
      if (!montado.current) return;
      const url = URL.createObjectURL(p.blob);
      if (pestana) pestana.location.href = url; else guardarArchivo(p.blob, p.filename);
    } catch (e) {
      pestana?.close();
      if (montado.current) setErrorDescarga(textoDescarga(e));
    } finally { if (montado.current) setOcupado(false); }
  };
  const descargar = (): Promise<void> => (doc ? descargarPorId(doc.id) : Promise.resolve());
  const nuevaRevisionDe = (documentoId: string): Promise<void> => ejecutar(() => crearRevisionNueva(documentoId), () => ({ tipo: 'success', texto: 'Nueva revisión creada como borrador a partir de la última versión finalizada.' }), true);

  const confirmarElaboro = (): Promise<void> => (doc ? ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, elaboroNombre: elaboro, elaboroConfirmado: true }), () => ({ tipo: 'success', texto: 'Elaboró confirmado.' })) : Promise.resolve());
  const guardarAutorizo = (): Promise<void> => (doc ? ejecutar(() => actualizarBorrador(doc.id, { version: doc.version, autorizoNombre: autorizo }), () => ({ tipo: 'success', texto: 'Autorizó actualizado (opcional; no hay flujo de autorización).' })) : Promise.resolve());
  const asignar = (): Promise<void> => (doc ? ejecutar(() => asignarRevisor(doc.id, doc.version, revisorSel === '' ? null : revisorSel), () => ({ tipo: 'success', texto: revisorSel === '' ? 'Revisor retirado.' : 'Revisor asignado.' })) : Promise.resolve());
  const registrar = (): Promise<void> => (doc ? ejecutar(() => registrarRevision(doc.id, doc.version), () => ({ tipo: 'success', texto: 'Tu revisión quedó registrada sobre esta versión.' })) : Promise.resolve());
  /**
   * Finalizar y generar el PDF. Un solo intento a la vez (los clics repetidos se ignoran). Primero se guardan los cambios pendientes (si no se pueden guardar, NO se finaliza); después el
   * servidor vuelve a validar la copia guardada, genera el PDF y registra la revisión. El resultado (éxito o error) se comunica en la sección «Finalizar hoja», donde está el usuario.
   * Una respuesta tardía de un guardado no puede reemplazar una revisión finalizada (`gen`).
   */
  const finalizar = async (): Promise<void> => {
    if (!doc || finalizandoRef.current) return;
    finalizandoRef.current = true;
    const mia = ++solicitud.current;
    setFinalizando(true); setErrorFin(null); setAviso(null); setMotivos([]); setConflicto(false);
    try {
      let actual = doc;
      if (autoguardar && (sucio || riesgoRef.current)) {
        const r = await guardarAuto(true);
        if (!montado.current || mia !== solicitud.current) return;
        if (!r.ok || !r.doc) { setErrorFin({ texto: 'No se pudieron guardar los últimos cambios, así que la hoja no se finalizó. Revisa el aviso de guardado y vuelve a intentar.', motivos: [] }); return; }
        actual = r.doc;
      }
      try {
        const r = await finalizarDocumento(actual.id, actual.version);
        if (!montado.current || mia !== solicitud.current) return;
        gen.current += 1;                                        // ninguna respuesta de guardado anterior puede reemplazar la revisión finalizada
        setDoc(r); setAviso({ tipo: 'success', texto: 'Hoja finalizada. El PDF quedó almacenado.' }); setErrorFin(null);
      } catch (e) {
        if (!montado.current || mia !== solicitud.current) return;
        // Sin respuesta definitiva (red caída, 5xx, conflicto de versión o «ya finalizada»): el servidor pudo haber finalizado. Se consulta el estado REAL antes de ofrecer otro intento.
        const ambiguo = !(e instanceof DocumentApiError) || ['NETWORK', 'FAILED', 'INVALID_RESPONSE', 'VERSION_CONFLICT', 'ALREADY_FINAL'].includes(e.kind);
        if (ambiguo) {
          try {
            const real = await obtenerDocumento(actual.id);
            if (!montado.current || mia !== solicitud.current) return;
            if (real.estado === 'FINALIZADA') {
              gen.current += 1;
              setDoc(real); setAviso({ tipo: 'success', texto: 'Hoja finalizada. El PDF quedó almacenado.' }); setErrorFin(null);
              return;
            }
            if (real.estado === 'FINALIZANDO') { setDoc(real); setErrorFin({ texto: 'La finalización sigue en curso en el servidor. Espera un momento y consulta «Hojas de este código» antes de volver a intentar.', motivos: [] }); return; }
            const r = reportarError(e);
            setErrorFin({ ...r, texto: `${r.texto} Se comprobó en el servidor: la hoja sigue como borrador, así que puedes reintentar.` });
          } catch {
            if (!montado.current || mia !== solicitud.current) return;
            const r = reportarError(e);
            setErrorFin({ ...r, texto: `${r.texto} No se pudo comprobar si la hoja llegó a finalizarse: antes de reintentar revisa «Hojas de este código».` });
          }
          return;
        }
        setErrorFin(reportarError(e));
      }
    } finally {
      finalizandoRef.current = false;
      if (montado.current) { setFinalizando(false); if (mia === solicitud.current) { setOcupado(false); setConfirmando(null); } }
    }
  };
  /**
   * Descarta el borrador. Primero se espera a que termine un guardado en curso (para usar la versión vigente) y se anula cualquier guardado automático pendiente; al confirmarlo el servidor, el documento
   * activo se limpia, las respuestas tardías de guardado quedan obsoletas (`gen`) y la página cierra el formulario. Si el servidor rechaza, el borrador sigue abierto y editable.
   */
  const descartar = async (): Promise<void> => {
    const abierto = espejo.current.doc;
    if (!abierto) return;
    // Uso independiente (sin página que cierre el formulario): se conserva el comportamiento anterior, el documento queda como descartado en el panel.
    if (!onDescartado) { await ejecutar(() => descartarBorrador(abierto.id, abierto.version), () => ({ tipo: 'info', texto: 'Borrador descartado.' })); return; }
    const mia = ++solicitud.current;
    descartando.current = true;
    setOcupado(true); setAviso(null); setMotivos([]); setConflicto(false);
    try {
      const previo = enVuelo.current ? await (enVuelo.current as Promise<{ doc: DocumentoVista | null } | undefined>).catch(() => undefined) : undefined;
      const base = previo?.doc ?? abierto;
      await descartarBorrador(base.id, base.version);
      if (!montado.current || mia !== solicitud.current) return;
      setDoc(null); setAviso(null); setMotivos([]); setConflicto(false); setVariante(''); reiniciarBase();
      onDescartado?.(base);
    } catch (e) {
      if (!montado.current || mia !== solicitud.current) return;
      reportarError(e);
    } finally {
      descartando.current = false;
      if (montado.current && mia === solicitud.current) { setOcupado(false); setConfirmando(null); }
    }
  };
  const cancelarFin = (): Promise<void> => (doc ? ejecutar(() => cancelarFinalizacion(doc.id, doc.version), () => ({ tipo: 'info', texto: 'Finalización cancelada: vuelve a ser borrador.' })) : Promise.resolve());
  const reintentarFin = (): Promise<void> => (doc ? ejecutar(() => finalizarDocumento(doc.id, doc.version), () => ({ tipo: 'success', texto: 'Hoja finalizada.' })) : Promise.resolve());
  const cerrar = (): void => { solicitud.current += 1; setErrorFin(null); setDoc(null); setAviso(null); setMotivos([]); setConflicto(false); setOcupado(false); setVariante(''); reiniciarBase(); };

  const vigentes = doc?.confirmaciones.filter((k) => k.vigente) ?? [];
  const obsoletas = (doc?.confirmaciones.length ?? 0) - vigentes.length;
  const elaboroCambiado = doc ? (elaboro.trim() || null) !== doc.elaboro.nombre : false;

  // Los mismos responsables que usará el servidor: lo que se está editando (se guarda antes de finalizar) o, si no se tocó, lo guardado. Con firma, el nombre es el de su propietaria.
  const etiquetaFuncion = (f: string): string => FUNCIONES.find((x) => x.valor === f)?.etiqueta ?? f;
  const responsablesAImprimir = ((): Array<{ posicion: number; funcion: string; nombre: string; conFirma: boolean }> => {
    const base = carga?.responsables
      ? carga.responsables.map((r) => ({ funcion: r.funcion as string, nombre: r.nombre, conFirma: Boolean(r.firmaId) }))
      : (doc?.responsables ?? []).map((r) => ({ funcion: r.funcion as string, nombre: r.nombre, conFirma: r.conFirma }));
    const lista = base.map((r, i) => ({ posicion: i + 1, funcion: etiquetaFuncion(i === 0 ? 'GENERO' : r.funcion), nombre: (r.nombre.trim() || (i === 0 ? doc?.elaboro.nombre ?? '' : '')).trim(), conFirma: r.conFirma })).filter((r) => r.nombre !== '');
    return lista.length > 0 ? lista : [{ posicion: 1, funcion: 'Generó', nombre: doc?.elaboro.nombre ?? '', conFirma: false }];
  })();

  const valor: Documento = {
    doc, codigo, carga, variante, setVariante, finalizando, errorFin, errorDescarga, verFinalizada, ocupado: ocupado || autoOcupado || finalizando, aviso, motivos, conflicto, revisores, revisorSel, setRevisorSel, elaboro, setElaboro, autorizo, setAutorizo, sucio, vigentes, obsoletas, elaboroCambiado,
    confirmando, setConfirmando, guardar, recargar, abrirPorId, descargar, descargarPorId, nuevaRevisionDe, confirmarElaboro, guardarAutorizo, asignar, registrar, finalizar, descartar, cancelarFin, reintentarFin,
    autoguardar, guardado: guardado === 'guardando' ? 'guardando' : pendiente ? 'pendiente' : guardado, guardadoEn, guardarAhora: async () => { await guardarAuto(true); },
    soloConsulta, puedeEditarComoAdmin, editarComoAdmin: () => { if (docServidor) setEdicionAdminDe(docServidor.id); },
    abrirHistorial: (porCodigo) => setHistorial({ abierto: true, codigo: porCodigo ? (codigo ?? '') : '' }), cerrar
  };

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Dialog open={confirmando === 'finalizar'} onClose={() => setConfirmando(null)} aria-labelledby="fin-titulo">
        <DialogTitle id="fin-titulo">Finalizar la hoja</DialogTitle>
        <DialogContent>
          <Typography>Se generará el PDF de PRUEBA desde la copia guardada (versión {doc?.version}) y se registrará como revisión definitiva. Después no podrá modificarse; los cambios requerirán una nueva revisión.</Typography>
          {autoguardar && <Typography sx={{ mt: 1 }}>Al finalizar confirmas el nombre de «Generó»: <b>{carga?.responsables?.[0]?.nombre ?? doc?.elaboro.nombre ?? ''}</b>.</Typography>}
          {autoguardar && (
            <Box sx={{ mt: 1.5 }} data-testid="fin-responsables">
              <Typography variant="subtitle2" component="h3">Responsables que se imprimirán</Typography>
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {responsablesAImprimir.map((r) => (
                  <li key={r.posicion}><Typography variant="body2"><b>{r.funcion}</b> · {r.nombre} — {r.conFirma ? 'con firma' : 'sin firma (el espacio queda vacío para firmar a mano)'}</Typography></li>
                ))}
              </Box>
            </Box>
          )}
          <Typography sx={{ mt: 1 }} variant="body2" color="text.secondary">El PDF respeta la plantilla original, sin leyendas añadidas; la revisión, la fecha y la huella quedan en el historial del Hub.{sucio ? ' Los cambios pendientes se guardan antes de finalizar.' : ''}</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={finalizando} onClick={() => setConfirmando(null)}>Cancelar</Button>
          <Button variant="contained" color="success" disabled={ocupado || finalizando} onClick={() => void finalizar()} startIcon={finalizando ? <CircularProgress size={16} color="inherit" /> : undefined}>{finalizando ? 'Finalizando…' : 'Finalizar'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={confirmando === 'descartar'} onClose={() => setConfirmando(null)} aria-labelledby="desc-titulo">
        <DialogTitle id="desc-titulo">Descartar el borrador</DialogTitle>
        <DialogContent><Typography>El borrador quedará descartado y no podrá recuperarse. Podrás guardar un borrador nuevo con el mismo código y variante cuando lo necesites.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(null)}>Cancelar</Button>
          <Button color="error" disabled={ocupado} onClick={() => void descartar()}>Descartar</Button>
        </DialogActions>
      </Dialog>
      <DocumentHistoryDialog abierto={historial.abierto} codigoInicial={historial.codigo} onClose={() => setHistorial((h) => ({ ...h, abierto: false }))} onAbrir={(id) => void abrirPorId(id)} />
    </Contexto.Provider>
  );
}

/** Indicador discreto del guardado automático. «Cambios guardados» solo aparece tras la confirmación del servidor. */
function IndicadorGuardado() {
  const d = useDocumento();
  const hora = d.guardadoEn ? d.guardadoEn.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
  if (d.guardado === 'guardando') return <Stack direction="row" spacing={0.75} alignItems="center" role="status"><CircularProgress size={14} /><Typography variant="body2" color="text.secondary">Guardando…</Typography></Stack>;
  if (d.guardado === 'pendiente') return <Typography variant="body2" color="text.secondary" role="status">Cambios sin guardar…</Typography>;
  if (d.guardado === 'guardado') return <Stack direction="row" spacing={0.5} alignItems="center" role="status" title={hora ? `Guardado a las ${hora}` : undefined}><CheckRoundedIcon sx={{ fontSize: 16 }} color="success" /><Typography variant="body2" color="text.secondary">Cambios guardados</Typography></Stack>;
  if (d.guardado === 'error') return <Stack direction="row" spacing={1} alignItems="center" role="status"><Typography variant="body2" color="error">Error al guardar</Typography><Button size="small" onClick={() => void d.guardarAhora()}>Reintentar</Button></Stack>;
  if (d.guardado === 'conflicto') return <Typography variant="body2" color="error" role="status">Conflicto de versión: no se guardó</Typography>;
  if (d.guardado === 'existe') return <Typography variant="body2" color="error" role="status">Ya existe esa hoja</Typography>;
  return null;
}

/**
 * Encabezado del formulario (sin tarjeta propia): estado de la hoja y acciones contextuales. Distingue una hoja PREPARADA pero no guardada (solo vive en pantalla) de un borrador
 * PERSISTIDO en PostgreSQL (TEST), y ofrece solo las acciones que corresponden a ese estado.
 */
export function BarraDocumento() {
  const d = useDocumento();
  const { doc } = d;
  const nombre = doc ? `${doc.codigo}${doc.variante ? ` · ${doc.variante}` : ''} · ${etiquetaRevision(doc)} · v${doc.version}` : '';
  return (
    <Box component="section" aria-label="Estado y acciones de la hoja" data-testid="document-panel" sx={{ mt: 2, pb: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        {!doc && <Chip size="small" color="warning" variant="outlined" label="Hoja preparada · sin guardar" data-testid="estado-sin-guardar" />}
        {doc && <Chip size="small" color={doc.estado === 'FINALIZADA' ? 'success' : 'default'} label={nombre} data-testid="estado-guardado" />}
        {doc && d.soloConsulta && <Chip size="small" color="info" label="Solo lectura" data-testid="solo-lectura" />}
        {doc && !doc.propio && doc.estado !== 'FINALIZADA' && <Chip size="small" variant="outlined" label={`De ${doc.propietario?.nombre ?? doc.creadoPor}`} data-testid="propietario" />}
        {doc && doc.estado !== 'DESCARTADA' && !d.soloConsulta && <Chip size="small" color="success" variant="outlined" label="Guardada en PostgreSQL (TEST)" />}
        {doc?.cliente && !doc.cliente.verificado && <Chip size="small" color="warning" variant="outlined" label="Cliente sin verificar (manual de TEST)" />}
        {!d.autoguardar && d.sucio && doc?.estado === 'BORRADOR' && <Chip size="small" color="info" label="Cambios sin guardar" />}
        {d.autoguardar && !d.soloConsulta && <IndicadorGuardado />}
        <Chip size="small" variant="outlined" color="warning" label="PRUEBA · NO VÁLIDO PARA PRODUCCIÓN" />
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<HistoryRoundedIcon />} onClick={() => d.abrirHistorial(true)}>Historial de este código</Button>
      </Stack>

      {doc && d.soloConsulta && (
        <Alert severity="info" sx={{ mt: 1 }} role="note" data-testid="aviso-consulta"
          action={d.puedeEditarComoAdmin ? <Button color="inherit" size="small" onClick={d.editarComoAdmin}>Editar como administrador</Button> : undefined}>
          {doc.estado === 'FINALIZANDO'
            ? `Finalización en curso de ${doc.propietario?.nombre ?? doc.creadoPor}: el contenido está congelado y el PDF todavía no es definitivo. Es una consulta de solo lectura.`
            : `Estás consultando el borrador de ${doc.propietario?.nombre ?? doc.creadoPor}. Es solo lectura: desde aquí no se modifica, descarta ni finaliza, y nada se guarda al abrirlo.`}
        </Alert>
      )}

      {/* ------------------------------------------------------------- acciones según el estado */}
      {d.autoguardar ? (
        <>
          {!doc && d.guardado === 'existe' && (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              <TextField size="small" label="Variante" value={d.variante} onChange={(e) => d.setVariante(e.target.value)} sx={{ width: 200 }} slotProps={{ htmlInput: { maxLength: 40, autoComplete: 'off' } }}
                helperText="Ya existe una hoja con este código y variante: usa otra variante o ábrela desde la lista." />
            </Stack>
          )}
          {!doc && d.guardado === 'inactivo' && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {d.carga ? 'Esta hoja se guardará sola como borrador en cuanto confirmes la familia. Aún no existe en la base de datos.' : 'Elige la familia para empezar. La hoja se guardará sola como borrador; aún no existe en la base de datos.'}
            </Typography>
          )}
        </>
      ) : (
        <>
          {(!doc || (doc.estado === 'BORRADOR' && !d.soloConsulta)) && (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              {!doc && <TextField size="small" label="Variante (opcional)" value={d.variante} onChange={(e) => d.setVariante(e.target.value)} sx={{ width: 220 }} slotProps={{ htmlInput: { maxLength: 40 } }} />}
              <Button variant="contained" onClick={() => void d.guardar()} disabled={d.ocupado || !d.carga || !d.codigo || (Boolean(doc) && !d.sucio) || (doc ? !doc.permisos.editar : false)}>
                {d.ocupado ? <CircularProgress size={18} color="inherit" /> : doc ? 'Guardar cambios' : 'Guardar borrador'}
              </Button>
              {doc?.estado === 'BORRADOR' && <Button variant="contained" color="success" disabled={d.ocupado || d.sucio || !doc.permisos.finalizar} onClick={() => d.setConfirmando('finalizar')} aria-describedby="finalizar-ayuda">Finalizar hoja</Button>}
              {doc?.estado === 'BORRADOR' && <Button color="inherit" disabled={d.ocupado || !doc.permisos.editar} onClick={() => d.setConfirmando('descartar')}>Descartar borrador</Button>}
            </Stack>
          )}
          {!doc && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {d.carga ? 'Esta hoja todavía no existe en la base de datos: se crea al pulsar «Guardar borrador». Variante: ej. Doblada, Extendida (un código puede tener varias hojas).' : 'Elige la familia para poder guardar. Esta hoja todavía no existe en la base de datos.'}
            </Typography>
          )}
          {doc?.estado === 'BORRADOR' && !d.soloConsulta && (
            <Typography id="finalizar-ayuda" variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
              {!doc.permisos.editar ? 'Solo el creador o un administrador pueden modificar este borrador. ' : ''}
              {d.sucio ? 'Guarda los cambios antes de finalizar: el PDF se genera desde la copia guardada. ' : ''}Para finalizar: «Elaboró» confirmado, cliente identificado, hoja completa y contradicciones reconocidas.
            </Typography>
          )}
        </>
      )}

      {d.aviso && <Alert severity={d.aviso.tipo} sx={{ mt: 1 }} role={d.aviso.tipo === 'error' ? 'alert' : 'status'}>{d.aviso.texto}</Alert>}
      {d.conflicto && <Button size="small" sx={{ mt: 1 }} onClick={() => void d.recargar()} disabled={d.ocupado}>Recargar la versión vigente (reemplaza lo que ves en pantalla)</Button>}
      {!d.autoguardar && d.motivos.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1 }} aria-label="Requisitos pendientes">
          <b>Requisitos pendientes:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>{d.motivos.map((m) => <li key={m.codigo}>{m.mensaje}{m.detalle && m.detalle.length > 0 ? ` (${m.detalle.join('; ')})` : ''}</li>)}</ul>
        </Alert>
      )}

      {doc?.estado === 'FINALIZANDO' && (
        <Alert severity="info" sx={{ mt: 1 }}>
          Hay una finalización en curso ({etiquetaRevision(doc)}). El contenido está congelado{d.soloConsulta ? ' y el PDF todavía no es definitivo' : ''}.
          {doc.permisos.finalizar && <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button size="small" onClick={() => void d.cancelarFin()} disabled={d.ocupado}>Cancelar finalización</Button>
            <Button size="small" onClick={() => void d.reintentarFin()} disabled={d.ocupado}>Reintentar (si pasaron más de 10 min)</Button>
          </Box>}
        </Alert>
      )}

      {doc?.estado === 'FINALIZADA' && !d.autoguardar && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Alert severity="success">
            Finalizada en TEST como <b>{etiquetaRevision(doc)}</b> por {doc.finalizadoPor ?? '—'}. Elaboró: {doc.elaboro.nombre}. {d.vigentes.length > 0 ? `Revisó: ${d.vigentes.map((k) => k.usuario).join(', ')}.` : 'Sin revisión registrada.'} Las versiones finalizadas no se modifican.
          </Alert>
          {doc.pdf && <Typography variant="caption" color="text.secondary">Archivo: {doc.pdf.nombre} · SHA-256 {doc.pdf.sha256.slice(0, 16)}…</Typography>}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={d.ocupado ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdfRoundedIcon />} onClick={() => void d.descargar()} disabled={d.ocupado || !doc.permisos.descargarPdf}>Descargar PDF finalizado</Button>
            <Button variant="outlined" onClick={() => void d.nuevaRevisionDe(doc.documentoId)} disabled={d.ocupado || !doc.permisos.crearRevisionNueva}>Crear nueva revisión</Button>
          </Stack>
          {!doc.permisos.crearRevisionNueva && <Typography variant="caption" color="text.secondary">Solo el creador del documento o un administrador pueden crear una nueva revisión.</Typography>}
        </Stack>
      )}
      {doc?.estado === 'DESCARTADA' && <Alert severity="info" sx={{ mt: 1 }}>Este borrador fue descartado.</Alert>}
    </Box>
  );
}

/**
 * «Elaboró», «Autorizó», revisor y revisión: sección del mismo formulario (solo mientras la hoja es un borrador). La revisión humana es OPCIONAL y secundaria: con guardado automático queda
 * en una sección plegable (la revisión registrada es trazable y está ligada a la huella de la especificación; no es la validación técnica del sistema). `revisionDatos` es la ranura de la
 * confirmación de revisión de datos en pantalla que ofrece el formulario.
 */
export function ResponsablesDocumento({ revisionDatos, responsables, onResponsables, puedeFirmas = false }: { revisionDatos?: ReactNode; responsables?: ResponsableLocal[]; onResponsables?: (r: ResponsableLocal[]) => void; puedeFirmas?: boolean } = {}) {
  const d = useDocumento();
  const { doc } = d;
  if (doc?.estado !== 'BORRADOR') return null;
  if (d.soloConsulta) {
    // Consulta de un borrador ajeno: solo se muestran los datos (sin campos ni controles de edición). La revisión autenticada del revisor asignado se conserva.
    return (
      <Paper component="section" variant="outlined" aria-label="Responsables y revisión (consulta)" id="responsables-seccion" sx={{ p: 2, mt: 2 }} data-testid="responsables-consulta">
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Responsables y revisión</Typography>
        <Stack spacing={0.5}>
          {doc.responsables.map((r) => <Typography key={r.posicion} variant="body2"><b>{FUNCIONES.find((f) => f.valor === r.funcion)?.etiqueta ?? r.funcion}:</b> {r.nombre || '—'}{r.conFirma ? ' · con firma' : ''}</Typography>)}
          <Typography variant="body2"><b>Autorizó:</b> {doc.autorizo ?? '—'}</Typography>
          <Typography variant="body2"><b>Revisor asignado:</b> {doc.revisor?.nombre ?? 'ninguno'}</Typography>
          {d.vigentes.map((k) => <Chip key={`${k.usuario}-${k.registradaEn}`} size="small" color="success" sx={{ alignSelf: 'flex-start' }} label={`Revisó: ${k.usuario}${k.autorrevision && !k.comoRevisorAsignado ? ' (autorrevisión)' : ''}`} />)}
          {doc.permisos.registrarRevision && <Box><Button variant="outlined" size="small" onClick={() => void d.registrar()} disabled={d.ocupado}>Registrar mi revisión</Button></Box>}
        </Stack>
      </Paper>
    );
  }
  const revision = (
    <Box>
      {doc.permisos.asignarRevisor && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField select size="small" label="Revisor asignado" value={d.revisorSel} onChange={(e) => d.setRevisorSel(e.target.value)} sx={{ minWidth: 280 }}>
            <MenuItem value=""><em>Sin revisor</em></MenuItem>
            {d.revisores.map((u) => <MenuItem key={u.id} value={u.id}>{u.displayName}</MenuItem>)}
          </TextField>
          <Button variant="outlined" size="small" onClick={() => void d.asignar()} disabled={d.ocupado || d.revisorSel === (doc.revisor?.id ?? '')}>Asignar revisor</Button>
        </Stack>
      )}
      {!doc.permisos.asignarRevisor && <Typography variant="body2">Revisor asignado: {doc.revisor?.nombre ?? 'ninguno'}</Typography>}
      <Box sx={{ mt: 1 }}>
        <Button variant="outlined" size="small" onClick={() => void d.registrar()} disabled={d.ocupado || d.sucio || !doc.permisos.registrarRevision} aria-describedby="revision-ayuda">Registrar mi revisión</Button>
        <Typography id="revision-ayuda" variant="caption" display="block" color="text.secondary">
          {d.sucio ? 'Guarda los cambios antes de revisar: la revisión se liga a la versión guardada. ' : ''}La registra tu cuenta (no se escribe ningún nombre) y pierde vigencia si cambia algo técnico. {doc.confirmaciones.some((k) => k.autorrevision) ? 'Hay una autorrevisión: queda constancia.' : ''}
        </Typography>
        {d.vigentes.map((k) => <Chip key={`${k.usuario}-${k.registradaEn}`} size="small" color="success" sx={{ mr: 0.5, mt: 0.5 }} label={`Revisó: ${k.usuario}${k.autorrevision && !k.comoRevisorAsignado ? ' (autorrevisión)' : ''}`} />)}
        {d.obsoletas > 0 && <Chip size="small" variant="outlined" sx={{ mt: 0.5 }} label={`${d.obsoletas} revisión(es) sin vigencia por cambios técnicos`} />}
      </Box>
      {revisionDatos}
    </Box>
  );
  if (d.autoguardar && responsables && onResponsables) {
    return (
      <Paper component="section" variant="outlined" aria-label="Responsables y firmas" id="responsables-seccion" sx={{ p: 2, mt: 2 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Responsables y firmas</Typography>
        <Stack spacing={2}>
          <ResponsablesFirmas responsables={responsables} onChange={onResponsables} puedeFirmas={puedeFirmas} disabled={!doc.permisos.editar} />
          <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' }, bgcolor: 'transparent' }} data-testid="opciones-avanzadas">
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="opciones-avanzadas-detalle" id="opciones-avanzadas-cabecera" sx={{ px: 0, minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5 } }}>
              <Typography variant="body2" color="text.secondary">Opciones avanzadas</Typography>
            </AccordionSummary>
            <AccordionDetails id="opciones-avanzadas-detalle" sx={{ px: 0 }}>
              <Typography variant="subtitle2" component="h3">Revisión interna del borrador</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>Solo para casos especiales. Es una constancia autenticada en el sistema: no es la función impresa «Revisó», no usa ninguna imagen de firma y no es requisito para finalizar.</Typography>
              {revision}
            </AccordionDetails>
          </Accordion>
        </Stack>
      </Paper>
    );
  }
  return (
    <Paper component="section" variant="outlined" aria-label="Responsables y revisión" id="responsables-seccion" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Responsables y revisión</Typography>
      <Stack spacing={2}>
        <Box>
          <Typography variant="subtitle2" component="h3">Elaboró (impreso en el documento)</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField size="small" label="Elaboró" value={d.elaboro} onChange={(e) => d.setElaboro(e.target.value)} disabled={!doc.permisos.editar} helperText={`Sugerido desde tu cuenta: ${doc.elaboro.sugerido}. Puedes editarlo; debe confirmarse expresamente.`} sx={{ minWidth: 280 }} />
            {doc.elaboro.confirmado && !d.elaboroCambiado ? <Chip size="small" color="success" label="Elaboró confirmado" /> : <Button variant="outlined" size="small" onClick={() => void d.confirmarElaboro()} disabled={d.ocupado || !doc.permisos.editar || !d.elaboro.trim()}>Confirmar «Elaboró»</Button>}
          </Stack>
        </Box>
        <Box>
          <Typography variant="subtitle2" component="h3">Autorizó (opcional)</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField size="small" label="Autorizó" value={d.autorizo} onChange={(e) => d.setAutorizo(e.target.value)} disabled={!doc.permisos.editar} helperText="Solo un nombre impreso: no hay flujo de autorización ni firma." sx={{ minWidth: 280 }} />
            <Button variant="outlined" size="small" onClick={() => void d.guardarAutorizo()} disabled={d.ocupado || !doc.permisos.editar || (d.autorizo.trim() || null) === doc.autorizo}>Guardar Autorizó</Button>
          </Stack>
        </Box>
        {d.autoguardar ? (
          <Accordion disableGutters variant="outlined" sx={{ '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} aria-controls="revision-opcional" id="revision-opcional-cabecera">
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="subtitle2" component="h3">Revisión del borrador (opcional)</Typography>
                {d.vigentes.length > 0 ? <Chip size="small" color="success" label={`${d.vigentes.length} ${d.vigentes.length === 1 ? 'revisión registrada' : 'revisiones registradas'}`} /> : <Typography variant="body2" color="text.secondary">No es requisito para finalizar</Typography>}
              </Stack>
            </AccordionSummary>
            <AccordionDetails id="revision-opcional">{revision}</AccordionDetails>
          </Accordion>
        ) : (
          <Box>
            <Typography variant="subtitle2" component="h3">Revisión (opcional)</Typography>
            {revision}
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

export type EstadoDatos = 'comprobando' | 'faltan' | 'observaciones' | 'completos' | 'no-disponible';
export interface BloqueoFinal { clave: string; texto: string; irA?: () => void }

/**
 * Sección final «Finalizar hoja»: resume en una línea el estado (guardado, datos, contradicciones, «Elaboró»), ofrece la ÚNICA acción «Finalizar y generar PDF» y, si hay algún bloqueo
 * conocido, explica qué falta con navegación al campo. La finalización real siempre vuelve a validar en el servidor sobre la versión ya guardada (`finalizar` guarda antes lo pendiente).
 * «Descartar borrador» es secundario y pide confirmación.
 */
export function FinalizarHojaDocumento({ datos, bloqueos, faltantes, contradicciones, onIntentar }: { datos: EstadoDatos; bloqueos: BloqueoFinal[]; faltantes: number; contradicciones: number; onIntentar?: () => void }) {
  const d = useDocumento();
  const { doc } = d;
  const [mostrar, setMostrar] = useState(false);
  const [verPendientes, setVerPendientes] = useState(false);
  const resultado = useRef<HTMLDivElement | null>(null);
  const eraBorrador = useRef(false);
  useEffect(() => {
    // Al terminar de finalizar el usuario ve el resultado: se lleva la pantalla a la tarjeta de resultado.
    if (doc?.estado === 'BORRADOR') eraBorrador.current = true;
    else if (doc?.estado === 'FINALIZADA' && eraBorrador.current) { eraBorrador.current = false; resultado.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
  }, [doc?.estado]);
  if (d.soloConsulta) return null;                                   // consulta de un borrador ajeno: no hay finalización ni descarte
  if (doc?.estado === 'FINALIZADA') {
    return (
      <Paper component="section" variant="outlined" aria-label="Finalizar hoja" sx={{ p: 2, mt: 2 }} ref={resultado} data-testid="final-resultado">
        <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Hoja finalizada</Typography>
        <Alert severity="success">
          Finalizada en TEST como <b>{etiquetaRevision(doc)}</b> por {doc.finalizadoPor ?? '—'}. Elaboró: {doc.elaboro.nombre}. {d.vigentes.length > 0 ? `Revisó: ${d.vigentes.map((k) => k.usuario).join(', ')}.` : 'Sin revisión registrada.'} Las versiones finalizadas no se modifican.
        </Alert>
        {doc.pdf && <Typography variant="body2" sx={{ mt: 1 }}>Archivo: <b>{doc.pdf.nombre}</b> <Typography component="span" variant="caption" color="text.secondary">· SHA-256 {doc.pdf.sha256.slice(0, 16)}…</Typography></Typography>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <Button variant="contained" startIcon={d.ocupado ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdfRoundedIcon />} onClick={() => void d.descargar()} disabled={d.ocupado || !doc.permisos.descargarPdf}>Descargar PDF finalizado</Button>
          <Button variant="outlined" onClick={() => void d.verFinalizada()} disabled={d.ocupado || !doc.permisos.descargarPdf}>Ver hoja finalizada</Button>
          <Button variant="text" onClick={() => void d.nuevaRevisionDe(doc.documentoId)} disabled={d.ocupado || !doc.permisos.crearRevisionNueva}>Crear nueva revisión</Button>
        </Stack>
        {d.errorDescarga && <Alert severity="error" sx={{ mt: 1 }} role="alert" data-testid="final-error-descarga">{d.errorDescarga}</Alert>}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Este es el documento definitivo de PRUEBA (entorno TEST). La vista previa de la hoja es de trabajo y no lo sustituye.</Typography>
      </Paper>
    );
  }
  if (doc?.estado !== 'BORRADOR') return null;
  const irAElaboro = (): void => { const s = document.getElementById('responsables-seccion'); s?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); s?.querySelector<HTMLElement>('input')?.focus(); };
  const irACliente = (): void => { const c = document.querySelector<HTMLElement>('[data-field="cliente"]'); c?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); c?.querySelector<HTMLElement>('input')?.focus(); };
  const irAMotivo = (codigo: string): (() => void) | undefined => (codigo === 'ELABORO_SIN_CONFIRMAR' ? irAElaboro : codigo === 'CLIENTE_REQUERIDO' ? irACliente : undefined);
  const lista: BloqueoFinal[] = [...bloqueos];
  const intentar = (): void => {
    if (lista.length > 0) { setMostrar(true); onIntentar?.(); return; }
    setMostrar(false);
    d.setConfirmando('finalizar');
  };
  // Textos propios de esta sección (el encabezado ya muestra el indicador de guardado automático con otras palabras).
  const guardado = d.guardado === 'guardando' ? { t: 'Guardando cambios…', c: 'default' as const }
    : d.guardado === 'pendiente' ? { t: 'Hay cambios por guardar', c: 'default' as const }
      : d.guardado === 'error' ? { t: 'No se pudo guardar', c: 'error' as const }
        : d.guardado === 'conflicto' ? { t: 'Versión desactualizada', c: 'error' as const }
          : d.guardado === 'guardado' || !d.sucio ? { t: 'Todo guardado', c: 'success' as const } : { t: 'Se guardará al finalizar', c: 'default' as const };
  const estadoDatos = datos === 'completos' ? { t: 'Datos completos', c: 'success' as const }
    : datos === 'faltan' ? { t: faltantes > 0 ? `Faltan datos obligatorios (${faltantes})` : 'Faltan datos obligatorios', c: 'warning' as const }
      : datos === 'observaciones' ? { t: 'Hay observaciones por revisar', c: 'warning' as const }
        : datos === 'no-disponible' ? { t: 'No se pudo comprobar ahora (se comprobará al finalizar)', c: 'default' as const }
          : { t: 'Comprobando datos…', c: 'default' as const };
  return (
    <Paper component="section" variant="outlined" aria-label="Finalizar hoja" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Finalizar hoja</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }} role="status" aria-label="Estado para finalizar">
        <Chip size="small" color={guardado.c} variant={guardado.c === 'default' ? 'outlined' : 'filled'} label={guardado.t} data-testid="final-guardado" />
        <Chip size="small" color={estadoDatos.c} variant={estadoDatos.c === 'default' ? 'outlined' : 'filled'} label={estadoDatos.t} data-testid="final-datos"
          {...(faltantes > 0 ? { onClick: () => setVerPendientes((v) => !v), 'aria-expanded': verPendientes, title: 'Ver cuáles son' } : {})} />
        <Chip size="small" color={contradicciones > 0 ? 'warning' : 'success'} variant={contradicciones > 0 ? 'filled' : 'outlined'} label={contradicciones > 0 ? `${contradicciones} ${contradicciones === 1 ? 'contradicción por reconocer' : 'contradicciones por reconocer'}` : 'Sin contradicciones pendientes'} data-testid="final-contradicciones" />
      </Stack>
      {verPendientes && !mostrar && bloqueos.length > 0 && (
        <Alert severity="info" variant="outlined" sx={{ mb: 1 }} data-testid="final-pendientes">
          <b>Pendiente en la hoja:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {bloqueos.map((b) => <li key={b.clave}>{b.texto}{b.irA ? <> <Button size="small" onClick={b.irA} aria-label={`Ir al campo: ${b.texto}`}>Ir al campo</Button></> : null}</li>)}
          </ul>
        </Alert>
      )}
      {d.errorFin && (
        <Alert severity="warning" sx={{ mb: 1 }} aria-label="Requisitos pendientes" data-testid="final-error" role="alert">
          <b>No se pudo finalizar.</b> {d.errorFin.texto}
          {d.errorFin.motivos.length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {d.errorFin.motivos.map((m) => {
                const ir = irAMotivo(m.codigo);
                const texto = `${m.mensaje}${m.detalle && m.detalle.length > 0 ? ` (${m.detalle.join('; ')})` : ''}`;
                return <li key={m.codigo}>{texto}{ir ? <> <Button size="small" onClick={ir} aria-label={`Ir al campo: ${m.mensaje}`}>Ir al campo</Button></> : null}</li>;
              })}
            </ul>
          )}
          <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>Tu borrador sigue intacto: corrige lo indicado y vuelve a intentar.</Typography>
        </Alert>
      )}
      {mostrar && lista.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }} data-testid="final-bloqueos">
          <b>Antes de finalizar falta:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {lista.map((b) => <li key={b.clave}>{b.texto}{b.irA ? <> <Button size="small" onClick={b.irA} aria-label={`Ir al campo: ${b.texto}`}>Ir al campo</Button></> : null}</li>)}
          </ul>
        </Alert>
      )}
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
        <Button variant="contained" color="success" disabled={d.ocupado || !doc.permisos.finalizar || d.guardado === 'conflicto'} onClick={intentar} aria-describedby="finalizar-ayuda"
          startIcon={d.finalizando ? <CircularProgress size={16} color="inherit" /> : undefined}>{d.finalizando ? 'Finalizando…' : 'Finalizar y generar PDF'}</Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" disabled={d.ocupado || !doc.permisos.editar} onClick={() => d.setConfirmando('descartar')}>Descartar borrador</Button>
      </Stack>
      <Typography id="finalizar-ayuda" variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {!doc.permisos.editar ? 'Solo el creador o un administrador pueden modificar este borrador. ' : ''}
        Al finalizar se guardan los cambios pendientes, se confirma el nombre de «Generó» tal como aparece arriba y el servidor vuelve a comprobar la hoja (datos obligatorios y contradicciones reconocidas) antes de generar el PDF de PRUEBA.
      </Typography>
    </Paper>
  );
}

/** Composición completa (barra + responsables) para usos que no distribuyen las partes en el formulario. */
export function DocumentPanel(props: Omit<ProviderProps, 'children'>) {
  return (
    <DocumentoProvider {...props}>
      <BarraDocumento />
      <ResponsablesDocumento />
    </DocumentoProvider>
  );
}

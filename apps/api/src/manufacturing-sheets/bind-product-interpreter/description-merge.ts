import type { AdvertenciaBase, Campo, CantidadPiezas, CalibreOriginal } from './bind-product.types';
import type { TituloInterpretado } from './title-parser';

// Fusión Title ↔ Description. El Description se interpreta con LA MISMA gramática que el Title (title-parser) y aquí se concilia campo por campo, sin un segundo motor:
//   · solo uno de los dos trae el dato           → se usa, con procedencia DESCRIPTION (o la del Title);
//   · ambos traen el mismo dato                  → TITLE_Y_DESCRIPTION (corroborado);
//   · ambos traen datos distintos                → CONTRADICCION: el campo queda pendiente y se advierte (no se elige una fuente como verdadera);
//   · ninguno                                    → pendiente (las advertencias de «ausente» del Title se conservan).
// Nunca convierte unidades ni valores. Función pura.

const tiene = <T>(c: Campo<T>): boolean => c.valor !== null && c.origen !== 'PENDIENTE';
/** Calibre: una lectura literal con la unidad pendiente (`CAL. 200`) también cuenta como dato (el formulario la conserva tal cual). */
const tieneLiteral = <T>(c: Campo<T>): boolean => c.valor !== null;
const pendienteContradiccion = <T>(nota: string): Campo<T> => ({ valor: null, origen: 'PENDIENTE', fuente: null, nota, procedencia: 'CONTRADICCION' });
const desdeDescripcion = <T>(c: Campo<T>): Campo<T> => ({ ...c, fuente: c.fuente === null ? null : `Description: ${c.fuente.trim()}`, procedencia: 'DESCRIPTION', nota: [c.nota, 'Dato tomado de Description (el título no lo indica).'].filter(Boolean).join(' ') });
const corroborado = <T>(c: Campo<T>): Campo<T> => ({ ...c, procedencia: 'TITLE_Y_DESCRIPTION', nota: [c.nota, 'Corroborado por Title y Description.'].filter(Boolean).join(' ') });

function fusionarSimple<T>(nombre: string, titulo: Campo<T>, desc: Campo<T>, igual: (a: T, b: T) => boolean, etiqueta: string, adv: AdvertenciaBase[], usable: (c: Campo<T>) => boolean = tiene): Campo<T> {
  const t = usable(titulo); const d = usable(desc);
  if (!d) return titulo;
  if (!t) return desdeDescripcion(desc);
  if (igual(titulo.valor as T, desc.valor as T)) return corroborado(titulo);
  adv.push({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', mensaje: `${etiqueta}: el título y la información adicional (Description) no coinciden («${titulo.fuente ?? ''}» frente a «${desc.fuente ?? ''}»). Se deja pendiente: confirma cuál es el correcto.`, campos: [nombre] });
  return pendienteContradiccion<T>(`${etiqueta}: Title y Description se contradicen; se deja pendiente.`);
}

export interface Fusion { titulo: TituloInterpretado; advertencias: AdvertenciaBase[]; usoDescripcion: string[] }

export function fusionarTituloDescripcion(titulo: TituloInterpretado, desc: TituloInterpretado): Fusion {
  const adv: AdvertenciaBase[] = [];
  const usados: string[] = [];
  const marcar = (nombre: string, antes: Campo<unknown>, despues: Campo<unknown>): void => { if (despues.procedencia === 'DESCRIPTION' && antes.procedencia !== 'DESCRIPTION') usados.push(nombre); };

  const tipo = fusionarSimple('tipo', titulo.tipo, desc.tipo, (a, b) => a === b, 'Tipo de producto', adv);
  const resina = fusionarSimple('resina', titulo.resina, desc.resina, (a, b) => a === b, 'Resina', adv);
  const presentacion = fusionarSimple('presentacion', titulo.presentacion, desc.presentacion, (a, b) => a === b, 'Presentación', adv);
  const calibre = fusionarSimple<CalibreOriginal>('calibre', titulo.calibre, desc.calibre, (a, b) => a.valorOriginal === b.valorOriginal && a.unidadOriginal === b.unidadOriginal, 'Calibre', adv, tieneLiteral);
  // Cantidad: se compara el número; si el título no dice la unidad y Description sí, se toma la de Description.
  let cantidad: Campo<CantidadPiezas> = titulo.cantidad;
  if (tiene(desc.cantidad)) {
    if (!tiene(titulo.cantidad)) cantidad = desdeDescripcion(desc.cantidad);
    else if (titulo.cantidad.valor!.cantidad !== desc.cantidad.valor!.cantidad) {
      adv.push({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', mensaje: `Cantidad: el título (${titulo.cantidad.valor!.cantidad}) y Description (${desc.cantidad.valor!.cantidad}) no coinciden. Se deja pendiente: confirma cuál es el correcto.`, campos: ['cantidad'] });
      cantidad = pendienteContradiccion('Cantidad: Title y Description se contradicen; se deja pendiente.');
    } else {
      const ut = titulo.cantidad.valor!.unidad; const ud = desc.cantidad.valor!.unidad;
      if (ut !== null && ud !== null && ut !== ud) {
        adv.push({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', mensaje: `Unidad de cantidad: el título dice ${ut} y Description ${ud}.`, campos: ['cantidad'] });
        cantidad = pendienteContradiccion('Unidad de cantidad contradictoria entre Title y Description.');
      } else if (ut === null && ud !== null) cantidad = { ...desdeDescripcion(desc.cantidad), origen: desc.cantidad.origen };
      else cantidad = corroborado(titulo.cantidad);
    }
  }

  // Medidas: se concilian como bloque (ancho, largo, fuelles y unidad).
  let { ancho, largo, fuelleTotal, fuelleDerecho, fuelleIzquierdo, unidadDimensiones } = titulo;
  const tMed = tiene(titulo.ancho) && tiene(titulo.largo);
  const dMed = tiene(desc.ancho) && tiene(desc.largo);
  // Description solo aporta las medidas cuando el Title NO habla de medidas: si el Title trae expresiones que no se pudieron resolver (varias, de otro número de dimensiones…) y Description no las corrobora, no se elige una fuente.
  if (dMed && !tMed && titulo.expresionesDeMedidas === 0) {
    ({ ancho, largo, fuelleTotal, fuelleDerecho, fuelleIzquierdo, unidadDimensiones } = {
      ancho: desdeDescripcion(desc.ancho), largo: desdeDescripcion(desc.largo), fuelleTotal: desc.fuelleTotal.valor === null ? desc.fuelleTotal : desdeDescripcion(desc.fuelleTotal),
      fuelleDerecho: desc.fuelleDerecho.valor === null ? desc.fuelleDerecho : desdeDescripcion(desc.fuelleDerecho), fuelleIzquierdo: desc.fuelleIzquierdo.valor === null ? desc.fuelleIzquierdo : desdeDescripcion(desc.fuelleIzquierdo),
      unidadDimensiones: tiene(desc.unidadDimensiones) ? desdeDescripcion(desc.unidadDimensiones) : desc.unidadDimensiones
    });
  } else if (dMed && !tMed && titulo.expresionesDeMedidas > 0) {
    adv.push({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', mensaje: `Medidas: el título trae expresiones de medidas que no se pudieron resolver y Description («${desc.ancho.fuente ?? ''}») no las corrobora. Se dejan pendientes: confirma cuáles son las correctas.`, campos: ['ancho', 'largo'] });
  } else if (dMed && tMed) {
    const mismas = titulo.ancho.valor === desc.ancho.valor && titulo.largo.valor === desc.largo.valor && titulo.fuelleTotal.valor === desc.fuelleTotal.valor;
    if (!mismas) {
      adv.push({ codigo: 'TITULO_DESCRIPCION_DISTINTOS', mensaje: `Medidas: el título («${titulo.ancho.fuente ?? ''}») y Description («${desc.ancho.fuente ?? ''}») no coinciden. Se dejan pendientes: confirma cuáles son las correctas.`, campos: ['ancho', 'largo'] });
      const nota = 'Medidas: Title y Description se contradicen; se dejan pendientes.';
      ancho = pendienteContradiccion(nota); largo = pendienteContradiccion(nota);
      fuelleTotal = pendienteContradiccion(nota); fuelleDerecho = pendienteContradiccion(nota); fuelleIzquierdo = pendienteContradiccion(nota);
      unidadDimensiones = pendienteContradiccion('Unidad pendiente: medidas contradictorias.');
    } else {
      // Que Title y Description digan lo mismo corrobora los NÚMEROS, no la interpretación: una lectura sugerida (tres medidas = Ancho × Fuelle × Largo) sigue siendo una sugerencia y NO se marca como corroborada.
      const coinciden = <T,>(c: Campo<T>): Campo<T> => (c.origen === 'SUGERIDO' ? { ...c, nota: [c.nota, 'La expresión coincide en Title y Description; la interpretación sigue pendiente de confirmar.'].filter(Boolean).join(' ') } : corroborado(c));
      ancho = coinciden(titulo.ancho); largo = coinciden(titulo.largo);
      if (titulo.fuelleTotal.valor !== null) { fuelleTotal = coinciden(titulo.fuelleTotal); fuelleDerecho = coinciden(titulo.fuelleDerecho); fuelleIzquierdo = coinciden(titulo.fuelleIzquierdo); }
      if (!tiene(titulo.unidadDimensiones) && tiene(desc.unidadDimensiones)) unidadDimensiones = desdeDescripcion(desc.unidadDimensiones);
      else if (tiene(titulo.unidadDimensiones) && tiene(desc.unidadDimensiones) && titulo.unidadDimensiones.valor !== desc.unidadDimensiones.valor) {
        adv.push({ codigo: 'UNIDAD_CONTRADICTORIA', mensaje: `La unidad de las medidas difiere entre el título (${titulo.unidadDimensiones.valor}) y Description (${desc.unidadDimensiones.valor}).`, campos: ['unidadDimensiones'] });
        unidadDimensiones = pendienteContradiccion('Unidad contradictoria entre Title y Description.');
      } else if (tiene(titulo.unidadDimensiones)) unidadDimensiones = corroborado(titulo.unidadDimensiones);
    }
  }

  // La unidad de la cantidad se sugiere según el tipo YA fusionado (p. ej. el Title dice «BOLSA» y Description solo «PAQUETE 200/B»); nunca por la «B» de «/B».
  if (cantidad.valor !== null && cantidad.valor.unidad === null && (tipo.valor === 'BOLSA' || tipo.valor === 'HOJA')) {
    const barraB = /\/\s*B\b/.test(cantidad.fuente ?? '');
    cantidad = { ...cantidad, valor: { cantidad: cantidad.valor.cantidad, unidad: tipo.valor === 'BOLSA' ? 'BOLSAS' : 'HOJAS' }, origen: 'SUGERIDO',
      nota: barraB ? 'La «B» de «/B» no está confirmada como «bolsas»: la unidad se sugiere según el tipo de producto. Revísala.' : 'La unidad (bolsas u hojas) no está escrita: se sugiere según el tipo de producto.' };
  }
  const fusion: TituloInterpretado = { ...titulo, tipo, resina, presentacion, calibre, cantidad, ancho, largo, fuelleTotal, fuelleDerecho, fuelleIzquierdo, unidadDimensiones, advertencias: titulo.advertencias };
  marcar('tipo', titulo.tipo, tipo); marcar('resina', titulo.resina, resina); marcar('presentacion', titulo.presentacion, presentacion); marcar('calibre', titulo.calibre, calibre);
  marcar('cantidad', titulo.cantidad, cantidad); marcar('ancho', titulo.ancho, ancho); marcar('unidadDimensiones', titulo.unidadDimensiones, unidadDimensiones);

  // Advertencias del Title que dejan de aplicar porque Description aportó el dato (p. ej. «el título no indica el calibre»).
  const resuelto = (codigo: string): boolean => {
    if (codigo === 'PRESENTACION_AUSENTE') return tiene(presentacion);
    if (codigo === 'CANTIDAD_AUSENTE') return tiene(cantidad);
    if (codigo === 'CALIBRE_AUSENTE') return tieneLiteral(calibre);
    if (codigo === 'MEDIDAS_INCOMPLETAS' || codigo === 'MEDIDAS_MULTIPLES' || codigo === 'MEDIDAS_NO_ESTANDAR') return tiene(ancho) && tiene(largo);
    if (codigo === 'UNIDAD_AUSENTE') return tiene(unidadDimensiones);
    return false;
  };
  fusion.advertencias = titulo.advertencias.filter((a) => !resuelto(a.codigo));
  // Advertencias informativas propias del Description (solo las que explican un dato tomado de él).
  for (const a of desc.advertencias) {
    const delDescription = (a.codigo === 'CALIBRE_SIN_UNIDAD' && calibre.procedencia === 'DESCRIPTION') || (a.codigo === 'MEDIDAS_TRES_DIMENSIONES_SUGERIDAS' && ancho.procedencia === 'DESCRIPTION');
    if (delDescription && !fusion.advertencias.some((x) => x.codigo === a.codigo)) adv.push(a);
  }
  return { titulo: fusion, advertencias: adv, usoDescripcion: usados };
}


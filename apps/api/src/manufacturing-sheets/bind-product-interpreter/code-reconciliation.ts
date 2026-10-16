import type { Advertencia, Campo, CodigoInterpretado, MaterialTipo, Resina, TipoProducto } from './bind-product.types';
import type { TituloInterpretado } from './title-parser';
import { normalizarTitulo } from './title-parser';

// Conciliación Title ↔ Code. El Title manda; el Code solo SUGIERE cuando el Title omite un dato y el Code lo identifica sin ambigüedad. Cada campo conserva su PROCEDENCIA:
//   TITLE          → extraído del título (el código no dice nada o no aplica)
//   CODE           → INFERIDO del código (nunca se presenta como extraído del título)
//   TITLE_Y_CODE   → corroborado por ambas fuentes
//   CONTRADICCION  → se conserva lo que dice el título (o se deja pendiente) y se advierte
// Si ambas fuentes son insuficientes, el campo queda PENDIENTE.

export interface Conciliacion {
  tipo: Campo<TipoProducto>;
  resina: Campo<Resina>;
  material: Campo<MaterialTipo>;
  claveMaterial: Campo<string>;
}

const FILM_EXPLICITO = /\b(FILM|PL[ÁA]STICO|POLIETILENO|LDPE|HDPE)\b/;
const CLAVE_PAPEL_EN_TITULO = /\bPW\d{2}\b/;

const pendiente = <T,>(nota: string, procedencia?: Campo<T>['procedencia']): Campo<T> => ({ valor: null, origen: 'PENDIENTE', fuente: null, nota, ...(procedencia ? { procedencia } : {}) });

export function conciliarConCodigo(titulo: TituloInterpretado, codigo: CodigoInterpretado, code: string, tituloOriginal: string, advertencias: Advertencia[]): Conciliacion {
  const t = normalizarTitulo(tituloOriginal);
  const usable = codigo.interpretable;
  let { tipo, resina } = titulo;

  // ------------------------------------------------------------ resina / composición
  if (usable && codigo.resina !== null) {
    const clave = codigo.claveMaterial as string;
    const nota = codigo.claveAmbigua ? `Clave CP del código: no permite separar CP5000 del consecutivo (se sugiere la familia CP5000).` : clave === 'LDPE' ? 'La clave LDPE del código se asocia a la composición Natural en el histórico: confírmalo.' : undefined;
    const omitida = resina.valor === null && resina.origen === 'PENDIENTE' && /no indica una resina/.test(resina.nota ?? '');
    if (resina.valor !== null && resina.origen !== 'PENDIENTE') {
      resina = resina.valor === codigo.resina
        ? { ...resina, procedencia: 'TITLE_Y_CODE', nota: `Corroborada por el código (${clave}).` }
        : { ...resina, procedencia: 'CONTRADICCION', nota: `El título indica ${resina.valor} y el código indica ${clave}: se conserva el título.` };
    } else if (omitida) {
      resina = { valor: codigo.resina, origen: 'SUGERIDO', fuente: `Code ${code} (${clave})`, procedencia: 'CODE', nota: `Inferida de la clave ${clave} del código; el título no indica la resina.${nota ? ` ${nota}` : ''}` };
      advertencias.push({ codigo: 'DATO_INFERIDO_DEL_CODIGO', mensaje: `La composición (${codigo.resina}) se infirió de la clave ${clave} del código porque el título no indica la resina. Confírmala.`, campos: ['resina'] });
      if (codigo.resina === 'ESD' || codigo.resina === 'XOW') {
        advertencias.push({ codigo: 'RESINA_SIN_CASILLA', mensaje: `La resina ${codigo.resina} (inferida del código) no tiene casilla de Composición en estas familias: requiere confirmación.`, campos: ['resina'] });
      }
    } else if (resina.valor === null) {
      resina = { ...resina, procedencia: 'CONTRADICCION', nota: `${resina.nota ?? ''} El código indica ${clave}, pero el título es contradictorio: se deja pendiente.`.trim() };
    }
  }

  // ------------------------------------------------------------ material (film / papel)
  const tituloMaterial: MaterialTipo | null = tipo.valor === 'PAPEL' || /\bPAPEL(?:ES)?\b/.test(t) ? 'PAPEL' : FILM_EXPLICITO.test(t) ? 'FILM' : null;
  const tituloImplicaFilm = tipo.valor === 'BOLSA' || tipo.valor === 'HOJA';
  const codigoMaterial: MaterialTipo | null = usable && codigo.material !== null ? (codigo.material === 'PAPER' ? 'PAPEL' : 'FILM') : null;
  let material: Campo<MaterialTipo>;
  if (tituloMaterial !== null) {
    material = codigoMaterial === null
      ? { valor: tituloMaterial, origen: 'EXTRAIDO', fuente: tituloMaterial === 'PAPEL' ? 'PAPEL' : 'film/plástico', procedencia: 'TITLE' }
      : codigoMaterial === tituloMaterial
        ? { valor: tituloMaterial, origen: 'EXTRAIDO', fuente: tituloMaterial === 'PAPEL' ? 'PAPEL' : 'film/plástico', procedencia: 'TITLE_Y_CODE', nota: `Corroborado por el código (${codigo.material === 'PAPER' ? 'P' : 'F'}).` }
        : { valor: tituloMaterial, origen: 'EXTRAIDO', fuente: tituloMaterial === 'PAPEL' ? 'PAPEL' : 'film/plástico', procedencia: 'CONTRADICCION', nota: `El título indica ${tituloMaterial === 'PAPEL' ? 'papel' : 'film'} y el código indica ${codigoMaterial === 'PAPEL' ? 'papel (P)' : 'film (F)'}: se conserva el título.` };
  } else if (codigoMaterial !== null) {
    if (tituloImplicaFilm && codigoMaterial === 'PAPEL') {
      material = pendiente('El título describe una bolsa u hoja (film) pero el código indica papel (P): contradicción; se conserva el título para el tipo y el material queda pendiente.', 'CONTRADICCION');
    } else {
      material = { valor: codigoMaterial, origen: 'SUGERIDO', fuente: `Code ${code} (${codigo.material === 'PAPER' ? 'P' : 'F'})`, procedencia: 'CODE', nota: `Inferido de la letra ${codigo.material === 'PAPER' ? 'P (Paper)' : 'F (Film)'} del código; el título no lo indica explícitamente.` };
    }
  } else if (usable && codigo.materialAmbiguo) {
    material = pendiente(`La letra del código es ambigua con la clave ${codigo.claveMaterial} (la «P»/«F» podría pertenecer al prefijo): no se infiere el material.`);
  } else {
    material = pendiente('Ni el título ni el código identifican el material (film o papel).');
  }

  // ------------------------------------------------------------ tipo de producto: solo el papel se puede inferir del código; «F» no determina bolsa u hoja
  if (tipo.valor === null && tipo.origen === 'PENDIENTE' && /no indica si es Bolsa u Hoja/.test(tipo.nota ?? '') && material.valor === 'PAPEL' && material.procedencia === 'CODE') {
    tipo = { valor: 'PAPEL', origen: 'SUGERIDO', fuente: material.fuente, procedencia: 'CODE', nota: 'Producto de papel inferido de la letra P del código.' };
  } else if (tipo.valor === 'PAPEL' && material.valor === 'PAPEL') {
    tipo = { ...tipo, procedencia: material.procedencia === 'CONTRADICCION' ? 'CONTRADICCION' : material.procedencia === 'TITLE_Y_CODE' ? 'TITLE_Y_CODE' : 'TITLE' };
  } else if (tipo.valor !== null && usable && codigo.material === 'PAPER' && tipo.valor !== 'PAPEL') {
    tipo = { ...tipo, procedencia: 'CONTRADICCION', nota: `El título indica ${tipo.valor} y el código indica papel (P): se conserva el título.` };
  } else if (tipo.valor === 'PAPEL' && usable && codigo.material === 'FILM') {
    tipo = { ...tipo, procedencia: 'CONTRADICCION', nota: 'El título indica papel y el código indica film (F): se conserva el título.' };
  }

  // ------------------------------------------------------------ clave del material (PMG, CP, LDPE, PW30, PW33…)
  const claveTitulo = CLAVE_PAPEL_EN_TITULO.exec(t)?.[0] ?? null;
  const claveCodigo = usable ? codigo.claveMaterial : null;
  let claveMaterial: Campo<string>;
  if (claveTitulo !== null) {
    claveMaterial = claveCodigo === null
      ? { valor: claveTitulo, origen: 'EXTRAIDO', fuente: claveTitulo, procedencia: 'TITLE' }
      : claveCodigo === claveTitulo
        ? { valor: claveTitulo, origen: 'EXTRAIDO', fuente: claveTitulo, procedencia: 'TITLE_Y_CODE', nota: 'Corroborada por el código.' }
        : { valor: claveTitulo, origen: 'EXTRAIDO', fuente: claveTitulo, procedencia: 'CONTRADICCION', nota: `El título indica ${claveTitulo} y el código indica ${claveCodigo}: se conserva el título.` };
  } else if (claveCodigo !== null && resina.procedencia === 'TITLE_Y_CODE') {
    claveMaterial = { valor: claveCodigo, origen: 'EXTRAIDO', fuente: `Code ${code}`, procedencia: 'TITLE_Y_CODE', nota: 'La resina del título coincide con la clave del código.' };
  } else if (claveCodigo !== null) {
    claveMaterial = { valor: claveCodigo, origen: 'SUGERIDO', fuente: `Code ${code}`, procedencia: 'CODE', nota: codigo.claveAmbigua ? 'Clave CP: el código no permite separar CP5000 del consecutivo.' : `Inferida del código (clave ${claveCodigo}).` };
  } else {
    claveMaterial = pendiente('El código no permite identificar la clave de resina o material.');
  }

  // Papel: producto válido de BIND, pero sin plantilla en este prototipo.
  if (material.valor === 'PAPEL' || tipo.valor === 'PAPEL') {
    advertencias.push({
      codigo: 'MATERIAL_PAPEL_SIN_PLANTILLA',
      mensaje: `Material papel${claveMaterial.valor && claveMaterial.valor.startsWith('PW') ? ` (clave ${claveMaterial.valor})` : ''}: no hay una plantilla de papel disponible en este prototipo. El producto es válido en BIND; la familia queda pendiente y no se asigna ninguna plantilla plástica.`,
      campos: ['tipo', 'material']
    });
  }
  return { tipo, resina, material, claveMaterial };
}

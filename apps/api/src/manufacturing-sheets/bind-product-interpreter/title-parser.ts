import type { Advertencia, CalibreOriginal, CantidadPiezas, Campo, CodigoAdvertencia, Presentacion, Resina, TipoProducto, UnidadDimension } from './bind-product.types';

/** Resultado de interpretar el título (descripción comercial) de un producto de BIND. */
export interface TituloInterpretado {
  tipo: Campo<TipoProducto>;
  resina: Campo<Resina>;
  ancho: Campo<number>;
  largo: Campo<number>;
  fuelleTotal: Campo<number>;
  fuelleDerecho: Campo<number>;
  fuelleIzquierdo: Campo<number>;
  unidadDimensiones: Campo<UnidadDimension>;
  calibre: Campo<CalibreOriginal>;
  presentacion: Campo<Presentacion>;
  cantidad: Campo<CantidadPiezas>;
  advertencias: Advertencia[];
}

const pendiente = <T>(nota?: string, valor: T | null = null, fuente: string | null = null): Campo<T> => ({ valor, origen: 'PENDIENTE', fuente, ...(nota ? { nota } : {}) });
const extraido = <T>(valor: T, fuente: string): Campo<T> => ({ valor, origen: 'EXTRAIDO', fuente });
const sugerido = <T>(valor: T, fuente: string, nota: string): Campo<T> => ({ valor, origen: 'SUGERIDO', fuente, nota });

/** Normaliza el título: mayúsculas, espacios simples, «×» → X, comillas tipográficas y '' → ". No convierte unidades ni valores. */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .toUpperCase()
    .replace(/[×✕]/g, 'X')
    .replace(/[“”″]|''/g, '"')
    .replace(/\bCP\s+5000\b/g, 'CP5000')
    .replace(/\s+/g, ' ')
    .trim();
}

const numero = (texto: string): number => Number(texto.replace(',', '.'));

// ---------------------------------------------------------------- tipo de producto
function interpretarTipo(t: string, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Campo<TipoProducto> {
  const tipos = new Set<TipoProducto>();
  if (/\bBOLSAS?\b/.test(t)) tipos.add('BOLSA');
  if (/\bHOJAS?\b/.test(t)) tipos.add('HOJA');
  if (/\bPAPEL(?:ES)?\b/.test(t)) tipos.add('PAPEL');
  if (tipos.size === 0) return pendiente('El título no indica si es Bolsa u Hoja.');
  // «Papel» es el material del producto: prevalece sobre las palabras Bolsa/Hoja, que también pueden ser la unidad de conteo (p. ej. «PAPEL ... C/100 HOJAS»).
  if (tipos.has('PAPEL')) {
    tipos.clear();
    tipos.add('PAPEL');
  }
  if (tipos.size > 1) {
    adv('TIPO_AMBIGUO', `El título menciona varios tipos de producto (${[...tipos].join(', ')}): se deja pendiente de confirmación.`, ['tipo']);
    return pendiente('Tipos contradictorios en el título.');
  }
  const tipo = [...tipos][0] as TipoProducto;
  if (tipo === 'PAPEL') adv('PRODUCTO_DE_PAPEL', 'Producto de papel: fuera del alcance de esta fase (solo Bolsa y Hoja de film).', ['tipo']);
  return extraido(tipo, tipo === 'PAPEL' ? 'PAPEL' : tipo === 'HOJA' ? 'HOJA' : 'BOLSA');
}

// ---------------------------------------------------------------- resina
const RESINAS: Resina[] = ['PMG', 'CP5000', 'NAT', 'ESD', 'XOW'];

function interpretarResina(t: string, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Campo<Resina> {
  const encontradas = new Set<Resina>();
  if (/\b(?:BOLSA|MATERIAL|COMPOSICI[ÓO]N|RESINA)\s+NATURAL\b/.test(t)) encontradas.add('NAT');
  for (const r of RESINAS) if (new RegExp(`\\b${r}\\b`).test(t)) encontradas.add(r);
  if (encontradas.size === 0) return pendiente('El título no indica una resina reconocida (PMG, CP5000, NAT, ESD o XOW).');
  if (encontradas.size > 1) {
    adv('RESINAS_CONTRADICTORIAS', `El título menciona varias resinas (${[...encontradas].join(', ')}): se deja pendiente de confirmación.`, ['resina']);
    return pendiente('Resinas contradictorias en el título.');
  }
  const resina = [...encontradas][0] as Resina;
  if (resina === 'ESD' || resina === 'XOW') {
    adv('RESINA_SIN_CASILLA', `La resina ${resina} no tiene casilla de Composición en Bolsa Plana 1 ni en Hoja Paq (PMG / CP5000 / Natural): requiere confirmación.`, ['resina']);
  }
  return extraido(resina, resina);
}

// ---------------------------------------------------------------- dimensiones
const UNIDAD = '(?:"|MM\\b|CM\\b|CENT[ÍI]METROS?\\b|IN\\b|PULGADAS?\\b|PULG\\b|METROS?\\b|MTS?\\b|M\\b)';
const NUM = '\\d+(?:[.,]\\d+)?';
const CADENA_MEDIDAS = new RegExp(`${NUM}\\s*${UNIDAD}?(?:\\s*X\\s*${NUM}\\s*${UNIDAD}?)+`, 'g');
const PARTE_MEDIDA = new RegExp(`^(${NUM})\\s*(${UNIDAD})?$`);

function unidadDe(texto: string): UnidadDimension {
  if (texto === '"' || texto === 'IN' || texto.startsWith('PULG')) return 'IN';
  if (texto === 'MM') return 'MM';
  if (/^(?:M|MT|MTS|METROS?)$/.test(texto)) return 'M';
  return 'CM';
}

interface Medidas {
  ancho: Campo<number>;
  largo: Campo<number>;
  fuelleTotal: Campo<number>;
  fuelleDerecho: Campo<number>;
  fuelleIzquierdo: Campo<number>;
  unidad: Campo<UnidadDimension>;
}

function interpretarMedidas(t: string, tipo: TipoProducto | null, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Medidas {
  const sinFuelles = { fuelleTotal: pendiente<number>('Sin fuelles en el título.'), fuelleDerecho: pendiente<number>('Sin fuelles en el título.'), fuelleIzquierdo: pendiente<number>('Sin fuelles en el título.') };
  const vacio = (nota: string): Medidas => ({ ancho: pendiente(nota), largo: pendiente(nota), ...sinFuelles, unidad: pendiente('Unidad dimensional sin determinar.') });
  // En rollos y termoencogibles no se presupone el orden comercial de las medidas.
  // Solo las etiquetas ANCHO / LARGO identifican esos dos campos; las cotas del dibujo siguen siendo independientes.
  if (/\bROLLO\s+CONTINUO\b|\bTERMOENCOG\w*\b/.test(t)) {
    const anchos = [...t.matchAll(new RegExp(`\\bANCHO\\s*[:=]?\\s*(${NUM})\\s*(${UNIDAD})?`, 'g'))];
    const largos = [...t.matchAll(new RegExp(`\\bLARGO\\s*[:=]?\\s*(${NUM})\\s*(${UNIDAD})?`, 'g'))];
    if (anchos.length === 1 && largos.length === 1) {
      const a = anchos[0]!; const l = largos[0]!;
      if (a[2] && l[2] && unidadDe(a[2]) === unidadDe(l[2])) return { ancho: extraido(numero(a[1]!), a[0]), largo: extraido(numero(l[1]!), l[0]), ...sinFuelles, unidad: extraido(unidadDe(a[2]), `${a[0]} / ${l[0]}`) };
      adv('UNIDAD_CONTRADICTORIA', 'Ancho y largo no tienen una misma unidad explícita: confirma ambos valores y su unidad. No se convierten medidas.', ['ancho', 'largo', 'unidadDimensiones']);
      return vacio('Unidades independientes o ausentes: captura las medidas sin conversión automática.');
    }
    adv('MEDIDAS_NO_ESTANDAR', 'Rollo o termoencogible: el orden de las dimensiones no es inequívoco. Captura ancho, largo y las cotas independientes del dibujo.', ['ancho', 'largo']);
    return vacio('Orden dimensional pendiente: no se supone Ancho × Largo.');
  }
  const cadenas = t.match(CADENA_MEDIDAS) ?? [];
  if (cadenas.length === 0) {
    adv('MEDIDAS_INCOMPLETAS', 'El título no contiene dos dimensiones (Ancho × Largo).', ['ancho', 'largo']);
    return vacio('No se encontraron dimensiones.');
  }
  if (cadenas.length > 1) {
    adv('MEDIDAS_MULTIPLES', `El título contiene varias expresiones de medidas (${cadenas.join(' | ')}): se deja pendiente de confirmación.`, ['ancho', 'largo']);
    return vacio('Medidas múltiples.');
  }
  const cadena = cadenas[0] as string;
  const partes = cadena.split(/\s*X\s*/).map((p) => PARTE_MEDIDA.exec(p.trim()));
  if (partes.some((p) => p === null)) {
    adv('MEDIDAS_INCOMPLETAS', `No se pudo leer la expresión de medidas «${cadena}».`, ['ancho', 'largo']);
    return vacio('Medidas ilegibles.');
  }
  const valores = partes.map((p) => ({ numero: numero(p?.[1] ?? ''), unidad: p?.[2] ?? null }));
  if (valores.length === 3 && tipo === 'BOLSA') {
    // Patrón Ancho × Fuelle total × Largo SOLO para una bolsa explícita: se SUGIERE (no se extrae), el fuelle total se reparte en dos mitades y todo es editable.
    // Tres medidas en otro tipo de producto, o sin tipo, siguen pendientes: no se asume que sean fuelles.
    const [a3, f3, l3] = valores as [{ numero: number; unidad: string | null }, { numero: number; unidad: string | null }, { numero: number; unidad: string | null }];
    adv('MEDIDAS_TRES_DIMENSIONES_SUGERIDAS', `El título tiene tres medidas («${cadena}»): se sugiere el patrón Ancho × Fuelle total × Largo, con el fuelle total repartido en dos mitades. Confírmalo.`, ['ancho', 'fuelleTotal', 'largo']);
    const patron = 'Patrón Ancho × Fuelle total × Largo supuesto por las tres medidas de una bolsa: confírmalo.';
    const mitad = f3.numero / 2;
    const unidadesTres = new Set([a3.unidad, f3.unidad, l3.unidad].filter((u): u is string => u !== null).map(unidadDe));
    const tres = {
      ancho: sugerido(a3.numero, cadena, patron), largo: sugerido(l3.numero, cadena, patron), fuelleTotal: sugerido(f3.numero, cadena, patron),
      fuelleDerecho: sugerido(mitad, cadena, 'Fuelle total ÷ 2 (derivado; editable).'), fuelleIzquierdo: sugerido(mitad, cadena, 'Fuelle total ÷ 2 (derivado; editable).')
    };
    if (unidadesTres.size === 0) {
      adv('UNIDAD_AUSENTE', 'El título no indica la unidad de las dimensiones (pulgadas o milímetros): pendiente de confirmación.', ['unidadDimensiones']);
      return { ...tres, unidad: pendiente('Sin unidad explícita en el título.') };
    }
    if (unidadesTres.size > 1) {
      adv('UNIDAD_CONTRADICTORIA', `Las medidas usan unidades distintas (${[...unidadesTres].join(', ')}).`, ['unidadDimensiones']);
      return vacio('Unidades contradictorias: confirma valores y unidad sin convertir.');
    }
    const unidadTres = [...unidadesTres][0] as UnidadDimension;
    return { ...tres, unidad: extraido(unidadTres, cadena) };
  }
  if (valores.length !== 2) {
    adv('MEDIDAS_NO_ESTANDAR', `El título tiene ${valores.length} dimensiones («${cadena}»); se esperan dos (Ancho × Largo): se deja pendiente de confirmación.`, ['ancho', 'largo']);
    return vacio('Número de dimensiones distinto de dos.');
  }
  const [a, l] = valores as [{ numero: number; unidad: string | null }, { numero: number; unidad: string | null }];
  const ancho = extraido(a.numero, cadena);
  const largo = extraido(l.numero, cadena);
  const dos = { ancho, largo, ...sinFuelles };
  const unidades = new Set([a.unidad, l.unidad].filter((u): u is string => u !== null).map(unidadDe));
  if (unidades.size === 0) {
    adv('UNIDAD_AUSENTE', 'El título no indica la unidad de las dimensiones (pulgadas o milímetros): pendiente de confirmación.', ['unidadDimensiones']);
    return { ...dos, unidad: pendiente('Sin unidad explícita en el título.') };
  }
  if (unidades.size > 1) {
    adv('UNIDAD_CONTRADICTORIA', `Las dos dimensiones usan unidades distintas (${[...unidades].join(', ')}).`, ['unidadDimensiones']);
    return vacio('Unidades contradictorias: confirma valores y unidad sin convertir.');
  }
  const unidad = [...unidades][0] as UnidadDimension;
  return { ...dos, unidad: extraido(unidad, cadena) };
}

// ---------------------------------------------------------------- calibre
const CALIBRE = new RegExp(`\\bCAL(?:IBRE)?\\.?\\s*(${NUM})\\s*(MILS?\\b|MIL\\b|MICRAS?\\b|MICRONES\\b)?`, 'g');

function interpretarCalibre(t: string, original: string, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Campo<CalibreOriginal> {
  const coincidencias = [...t.matchAll(CALIBRE)];
  if (coincidencias.length === 0) {
    adv('CALIBRE_AUSENTE', 'El título no indica el calibre (CAL.).', ['calibre']);
    return pendiente('Sin calibre en el título.');
  }
  const distintos = new Set(coincidencias.map((m) => `${m[1]}|${m[2] ?? ''}`));
  if (distintos.size > 1) {
    adv('CALIBRE_AMBIGUO', 'El título contiene varios calibres distintos: pendiente de confirmación.', ['calibre']);
    return pendiente('Calibres contradictorios.');
  }
  const m = coincidencias[0] as RegExpMatchArray;
  // Texto literal: la misma expresión sobre el título SIN pasar a mayúsculas (se conserva «3 mil», «2.7», «200» tal como los escribió BIND; nunca se agrega ni se convierte la unidad).
  const literal = [...original.replace(/\s+/g, ' ').matchAll(new RegExp(CALIBRE.source, 'gi'))][0];
  const textoLiteral = (literal?.[0] ?? m[0]).replace(/^CAL(?:IBRE)?\.?\s*/i, '').trim();
  const calibre: CalibreOriginal = { valorOriginal: m[1] as string, unidadOriginal: m[2] ?? null, textoLiteral };
  if (calibre.unidadOriginal === null) {
    // «CAL. 200» no se convierte en «2 MIL»: se conserva el valor original y la unidad/escala queda pendiente.
    adv('CALIBRE_SIN_UNIDAD', `Calibre «${m[0]}» sin unidad: se conserva el valor original y la unidad/escala queda pendiente (no se convierte).`, ['calibre']);
    return pendiente('Unidad o escala del calibre pendiente de confirmación; no se convierte.', calibre, m[0]);
  }
  return extraido(calibre, m[0]);
}

// ---------------------------------------------------------------- presentación
function interpretarPresentacion(t: string, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Campo<Presentacion> {
  const presentaciones = new Set<Presentacion>();
  if (/\bPAQUETES?\b|\bPAQ\b/.test(t)) presentaciones.add('PAQUETE');
  if (/\bROLLOS?\b/.test(t)) presentaciones.add('ROLLO');
  if (presentaciones.size === 0) {
    adv('PRESENTACION_AUSENTE', 'El título no indica la presentación (Rollo o Paquete).', ['presentacion']);
    return pendiente('Sin presentación en el título.');
  }
  if (presentaciones.size > 1) {
    adv('PRESENTACION_AMBIGUA', 'El título menciona Rollo y Paquete: pendiente de confirmación.', ['presentacion']);
    return pendiente('Presentaciones contradictorias.');
  }
  const p = [...presentaciones][0] as Presentacion;
  return extraido(p, p);
}

// ---------------------------------------------------------------- cantidad
const PIEZAS = '(BOLSAS?|HOJAS?|PZAS?|PIEZAS?)';
const CANTIDAD_PATRONES = [
  new RegExp(`\\bC/\\s*(\\d+)\\s*${PIEZAS}?\\b`, 'g'),
  new RegExp(`\\b(?:PAQUETES?|PAQ|ROLLOS?)\\s*(?:DE|CON)?\\s*(\\d+)\\s*${PIEZAS}\\b`, 'g'),
  new RegExp(`\\b(\\d+)\\s*(BOLSAS|HOJAS)\\b`, 'g')
];

function interpretarCantidad(t: string, tipo: TipoProducto | null, adv: (c: CodigoAdvertencia, m: string, campos: string[]) => void): Campo<CantidadPiezas> {
  const encontradas = new Map<string, { cantidad: number; unidad: 'BOLSAS' | 'HOJAS' | null; fuente: string }>();
  for (const patron of CANTIDAD_PATRONES) {
    for (const m of t.matchAll(patron)) {
      const palabra = m[2];
      const unidad = palabra === undefined ? null : palabra.startsWith('BOLSA') ? 'BOLSAS' : palabra.startsWith('HOJA') ? 'HOJAS' : null;
      const cantidad = Number(m[1]);
      encontradas.set(`${cantidad}`, { cantidad, unidad: unidad ?? encontradas.get(`${cantidad}`)?.unidad ?? null, fuente: m[0] });
    }
  }
  if (encontradas.size === 0) {
    adv('CANTIDAD_AUSENTE', 'El título no indica la cantidad de bolsas u hojas por paquete o rollo.', ['cantidad']);
    return pendiente('Sin cantidad en el título.');
  }
  if (encontradas.size > 1) {
    adv('CANTIDAD_AMBIGUA', `El título contiene varias cantidades (${[...encontradas.keys()].join(', ')}): pendiente de confirmación.`, ['cantidad']);
    return pendiente('Cantidades contradictorias.');
  }
  const { cantidad, unidad, fuente } = [...encontradas.values()][0] as { cantidad: number; unidad: 'BOLSAS' | 'HOJAS' | null; fuente: string };
  if (unidad === null) {
    // «C/200» sin la palabra Bolsas/Hojas: la unidad solo se sugiere a partir del tipo de producto.
    const sugerida = tipo === 'BOLSA' ? 'BOLSAS' : tipo === 'HOJA' ? 'HOJAS' : null;
    return { valor: { cantidad, unidad: sugerida }, origen: 'SUGERIDO', fuente, nota: 'La unidad (bolsas u hojas) no está escrita en el título: se sugiere según el tipo de producto.' };
  }
  return extraido({ cantidad, unidad }, fuente);
}

/** Interpreta el título de un producto de BIND. No convierte unidades ni asume la familia de manufactura. */
export function interpretarTitulo(titulo: string): TituloInterpretado {
  const t = normalizarTitulo(titulo ?? '');
  const advertencias: Advertencia[] = [];
  const adv = (codigo: CodigoAdvertencia, mensaje: string, campos: string[]): void => {
    advertencias.push({ codigo, mensaje, campos });
  };
  const tipo = interpretarTipo(t, adv);
  const resina = interpretarResina(t, adv);
  const medidas = interpretarMedidas(t, tipo.valor, adv);
  const calibre = interpretarCalibre(t, titulo ?? '', adv);
  const presentacion = interpretarPresentacion(t, adv);
  const cantidad = interpretarCantidad(t, tipo.valor, adv);
  const algo = [tipo, resina, medidas.ancho, calibre, presentacion, cantidad].some((c) => c.valor !== null);
  if (!algo) {
    advertencias.length = 0;
    adv('TITULO_NO_INTERPRETABLE', 'El título no contiene datos técnicos reconocibles: todos los campos quedan pendientes de captura.', ['tipo', 'resina', 'ancho', 'largo', 'unidadDimensiones', 'calibre', 'presentacion', 'cantidad']);
  }
  return { tipo, resina, ancho: medidas.ancho, largo: medidas.largo, fuelleTotal: medidas.fuelleTotal, fuelleDerecho: medidas.fuelleDerecho, fuelleIzquierdo: medidas.fuelleIzquierdo, unidadDimensiones: medidas.unidad, calibre, presentacion, cantidad, advertencias };
}

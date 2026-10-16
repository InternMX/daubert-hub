import type { Advertencia, BindProductInput, Campo, FamiliaPosible, ResultadoInterpretacion } from './bind-product.types';
import { interpretarCodigo } from './code-parser';
import { interpretarTitulo } from './title-parser';

const textoONulo = (valor: unknown): string | null => (typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null);

function fechaIso(valor: BindProductInput['CreationDate']): string | null {
  if (valor === undefined || valor === null) return null;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function interpretarPeso(peso: BindProductInput['Weight'], advertencias: Advertencia[]): Campo<number> {
  if (peso === undefined || peso === null || (typeof peso === 'string' && peso.trim() === '')) {
    advertencias.push({ codigo: 'PESO_AUSENTE', mensaje: 'BIND no entrega el peso del producto.', campos: ['pesoLb'] });
    return { valor: null, origen: 'PENDIENTE', fuente: null, nota: 'Sin peso en BIND.' };
  }
  const numero = typeof peso === 'number' ? peso : Number(String(peso).trim().replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0) {
    advertencias.push({ codigo: 'PESO_INVALIDO', mensaje: `El peso recibido de BIND («${String(peso)}») no es un número válido.`, campos: ['pesoLb'] });
    return { valor: null, origen: 'PENDIENTE', fuente: String(peso), nota: 'Peso no numérico o negativo.' };
  }
  if (numero === 0) {
    advertencias.push({ codigo: 'PESO_CERO', mensaje: 'El peso en BIND es cero: no se usa como dato de la hoja; requiere captura.', campos: ['pesoLb'] });
    return { valor: null, origen: 'PENDIENTE', fuente: String(peso), nota: 'Peso cero en BIND.' };
  }
  return { valor: numero, origen: 'EXTRAIDO', fuente: String(peso), nota: 'Libras (convención de Daubert México).' };
}

/**
 * Interpreta un producto de BIND para autocompletar los campos comunes de Bolsa Plana 1 y Hoja Paq.
 * Solo lee ID, Code, Title, Description, Weight y CreationDate: nunca costos, inventarios ni precios. No consulta BIND ni la base de datos.
 * La familia queda SIN CONFIRMAR; el código solo aporta información auxiliar y no sobrescribe al título.
 */
export function interpretarProductoBind(producto: BindProductInput): ResultadoInterpretacion {
  // Solo se leen los campos permitidos (cualquier otro, como precios o costos, se ignora aunque venga en el objeto).
  const { ID, Code, Title, Description, Weight, CreationDate } = producto;
  const code = (Code ?? '').trim();
  const titulo = interpretarTitulo(Title ?? '');
  const codigo = interpretarCodigo(code);
  const advertencias: Advertencia[] = [...titulo.advertencias];
  const peso = interpretarPeso(Weight, advertencias);

  // El código es auxiliar: puede contradecir al título, pero nunca lo sobrescribe.
  if (codigo.interpretable) {
    if (titulo.resina.valor !== null && codigo.resina !== null && codigo.resina !== titulo.resina.valor) {
      advertencias.push({ codigo: 'CODIGO_RESINA_DISTINTA', mensaje: `El código sugiere la resina ${codigo.resina}, pero el título indica ${titulo.resina.valor}: se conserva el título.`, campos: ['resina'] });
    }
    const materialTitulo = titulo.tipo.valor === 'PAPEL' ? 'PAPER' : titulo.tipo.valor === null ? null : 'FILM';
    if (materialTitulo !== null && codigo.material !== materialTitulo) {
      advertencias.push({ codigo: 'CODIGO_MATERIAL_DISTINTO', mensaje: `El código indica ${codigo.material === 'PAPER' ? 'papel (P)' : 'film (F)'}, pero el título indica ${titulo.tipo.valor}: se conserva el título.`, campos: ['tipo'] });
    }
  } else if (code !== '') {
    advertencias.push({ codigo: 'CODIGO_NO_INTERPRETABLE', mensaje: `El código «${code}» no sigue la estructura habitual (prefijo + F/P + resina + consecutivo); se conserva tal cual.`, campos: ['codigoDcmx'] });
  }

  const posibles: FamiliaPosible[] = titulo.tipo.valor === 'BOLSA' ? ['BOLSA_PLANA_1'] : titulo.tipo.valor === 'HOJA' ? ['HOJA_PAQ'] : [];
  advertencias.push({
    codigo: 'FAMILIA_NO_CONFIRMADA',
    mensaje: 'La familia de manufactura no se confirma automáticamente: la sugerida es provisional y la confirma el usuario (una bolsa de dos dimensiones no es necesariamente Bolsa Plana 1).',
    campos: ['familia']
  });

  const campos = {
    codigoDcmx: (code === '' ? { valor: null, origen: 'PENDIENTE', fuente: null, nota: 'BIND no entrega código.' } : { valor: code, origen: 'EXTRAIDO', fuente: 'Code' }) as Campo<string>,
    tipo: titulo.tipo,
    resina: titulo.resina,
    ancho: titulo.ancho,
    largo: titulo.largo,
    unidadDimensiones: titulo.unidadDimensiones,
    calibre: titulo.calibre,
    presentacion: titulo.presentacion,
    cantidad: titulo.cantidad,
    pesoLb: peso
  };
  const pendientes = Object.entries(campos).filter(([, campo]) => campo.origen === 'PENDIENTE').map(([nombre]) => nombre);

  return {
    producto: { id: String(ID), code, title: Title ?? '', informacionAdicional: textoONulo(Description), fechaAltaBind: fechaIso(CreationDate) },
    campos,
    codigo,
    familia: { valor: null, estado: 'PENDIENTE_CONFIRMACION', posiblesEstaFase: posibles },
    pendientes,
    advertencias
  };
}

/**
 * Sugerencia de datos para las plantillas de Bolsa Plana 1 y Hoja Paq a partir de lo EXTRAÍDO o SUGERIDO (nunca de lo pendiente). Solo incluye campos
 * comunes; no rellena cliente, fecha de emisión, color, etiqueta ni firmas, y no valida contra ninguna familia.
 */
export function sugerirDatosPlantilla(resultado: ResultadoInterpretacion): Record<string, string> {
  const { campos } = resultado;
  const datos: Record<string, string> = {};
  const usable = <T>(campo: Campo<T>): T | null => (campo.origen === 'PENDIENTE' ? null : campo.valor);
  if (campos.codigoDcmx.valor !== null) datos.codigo = campos.codigoDcmx.valor;
  if (resultado.producto.title.trim() !== '') datos.descripcion = resultado.producto.title.trim();
  const resina = usable(campos.resina);
  if (resina === 'PMG' || resina === 'CP5000' || resina === 'NAT') {
    datos.comp_pmg = resina === 'PMG' ? 'X' : 'NA';
    datos.comp_cp5000 = resina === 'CP5000' ? 'X' : 'NA';
    datos.comp_natural = resina === 'NAT' ? 'X' : 'NA';
  }
  const presentacion = usable(campos.presentacion);
  if (presentacion !== null) {
    datos.pres_rollo = presentacion === 'ROLLO' ? 'X' : 'NA';
    datos.pres_paquete = presentacion === 'PAQUETE' ? 'X' : 'NA';
  }
  const cantidad = usable(campos.cantidad);
  if (cantidad !== null && cantidad.unidad !== null) datos.cantidad = `${cantidad.cantidad} ${cantidad.unidad === 'BOLSAS' ? 'Bolsas' : 'Hojas'}`;
  const unidad = usable(campos.unidadDimensiones);
  const ancho = usable(campos.ancho);
  const largo = usable(campos.largo);
  if (unidad !== null && (unidad === 'IN' || unidad === 'MM') && ancho !== null && largo !== null) {
    datos.unidad_medidas = unidad === 'IN' ? 'Pulgadas (IN)' : 'Milímetros (MM)';
    const marca = unidad === 'IN' ? '"' : ' mm';
    datos.ancho = `${ancho}${marca}`;
    datos.largo = `${largo}${marca}`;
  }
  const calibre = usable(campos.calibre);
  if (calibre !== null && calibre.unidadOriginal !== null) datos.calibre = `${calibre.valorOriginal} ${calibre.unidadOriginal}`;
  const peso = usable(campos.pesoLb);
  if (peso !== null) datos.peso_bolsa_lb = peso.toFixed(4);
  return datos;
}

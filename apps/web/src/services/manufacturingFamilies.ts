import { apiBaseUrl } from './api';

// Configuración de las familias de manufactura: GET /api/manufacturing-sheets/families. El BACKEND es la autoridad (campos visibles, obligatorios, composiciones, colores,
// modalidades autorizadas); el frontend solo la consume para dibujar el formulario. No se guarda nada.

export type FamilyCode = 'BOLSA_PLANA_1' | 'HOJA_PAQ' | 'BOLSA_FUELLE' | 'BOLSA_NATURAL' | 'ROLLO_CONTINUO' | 'TERMOENCOGIBLE' | 'COEX';
export type Composition = 'PMG' | 'CP5000' | 'NAT';
export type UnitCode = 'IN' | 'MM' | 'CM' | 'M';

export type FieldKey =
  | 'codigo' | 'descripcion' | 'producto' | 'cliente' | 'fechaEmision' | 'resinaVci' | 'colorPreset' | 'colorConcentracion' | 'colorNombre' | 'colorHex'
  | 'composicion' | 'presentacion' | 'cantidad' | 'cantidadUnidad' | 'ancho' | 'largo' | 'unidadDimensiones' | 'calibre' | 'pesoLb' | 'etiqueta' | 'modalidad'
  | 'fuelleTotal' | 'fuelleDerecho' | 'fuelleIzquierdo' | 'anchoRollo' | 'anchoDoblado' | 'medidaPliegue' | 'largoPresentacionFinal' | 'anchoPresentacionFinal'
  | 'coexVariante' | 'pesoCapaInterior' | 'pesoCapaIntermedia' | 'pesoCapaExterior' | 'lbVciInterior' | 'lbVciIntermedia' | 'lbVciExterior';

export interface ColorPresetConfig { id: string; etiqueta: string; nombre: string; hex: string; cotasInternasHex: string }
export interface VarianteConfig {
  valor: string;
  etiqueta: string;
  colorTexto: string;
  colorCuerpo: string;
  colorCapaInterior: string;
  colorCapaIntermedia: string;
  colorCapaExterior: string;
  cotasInternasHex: string;
  presetEquivalente: string;
}
export interface CapaConfig { id: 'interior' | 'intermedia' | 'exterior'; etiqueta: string; resina: string; pesoKey: FieldKey; lbKey: FieldKey }
export interface ModalidadConfig { valor: string; etiqueta: string; habilitada: boolean; motivo?: string }

export interface FamilyConfig {
  codigo: FamilyCode;
  nombre: string;
  campos: FieldKey[];
  requeridos: FieldKey[];
  composiciones: Composition[];
  composicionFija: Composition | null;
  cantidad: boolean;
  fuelles: boolean;
  colorDibujo: boolean;
  colores: ColorPresetConfig[];
  colorSugerido: string | null;
  modalidades: ModalidadConfig[];
  variantes: VarianteConfig[];
  capas: CapaConfig[] | null;
  unidades: Array<{ valor: UnitCode; etiqueta: string }>;
  notas: string[];
}

export type FamiliesErrorKind = 'UNAUTHENTICATED' | 'UNAVAILABLE' | 'INVALID_RESPONSE' | 'NETWORK';

export class FamiliesError extends Error {
  constructor(public readonly kind: FamiliesErrorKind, public readonly status: number) {
    super('Families request failed');
  }
}

function isConfigList(body: unknown): body is { data: FamilyConfig[] } {
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray((body as { data: unknown }).data)) return false;
  return (body as { data: unknown[] }).data.every((f) => typeof f === 'object' && f !== null && typeof (f as FamilyConfig).codigo === 'string' && Array.isArray((f as FamilyConfig).campos) && Array.isArray((f as FamilyConfig).requeridos));
}

export async function listManufacturingFamilies(signal?: AbortSignal): Promise<FamilyConfig[]> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/manufacturing-sheets/families`, { method: 'GET', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new FamiliesError('NETWORK', 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new FamiliesError(response.status === 401 ? 'UNAUTHENTICATED' : 'UNAVAILABLE', response.status);
  if (!isConfigList(body)) throw new FamiliesError('INVALID_RESPONSE', response.status);
  return body.data;
}

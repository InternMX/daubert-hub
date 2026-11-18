import { BadGatewayException, BadRequestException, ConflictException, GatewayTimeoutException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { interpretarProductoBind, sugerirDatosPlantilla, sugerirEspecificacion } from '../bind-product-interpreter';
import type { Advertencia, FamiliaPosible, ResultadoInterpretacion, SugerenciasEspecificacion } from '../bind-product-interpreter';
import { BIND_RECENT_MAX_SKIP, BIND_RECENT_MAX_TOP, BindErpClient, isValidBindCode, isValidBindId } from './bind-erp.client';
import type { BindLookupResult, BindProductRaw } from './bind-erp.client';
import { clasificarNovedad, type NovedadProducto } from './recent-products';

/** Los seis campos de BIND que el Hub conserva; nada de costos, inventarios ni precios. */
export interface BindProductoOriginal {
  ID: string;
  Code: string;
  Title: string;
  Description: string | null;
  Weight: number | string | null;
  CreationDate: string | null;
}

export interface BindProductLookupResponse {
  data: {
    origen: 'BIND';
    producto: BindProductoOriginal;
    interpretacion: ResultadoInterpretacion;
    /** Sugerencias para la plantilla: solo lo extraído o sugerido; nunca lo pendiente. */
    datosSugeridosPlantilla: Record<string, string>;
    /** Familia sugerida (0 o 1): provisional y editable; la confirma el usuario. */
    familiaSugerida: FamiliaPosible[];
    /** Sugerencias de la fase 3.1 (familia con motivo, resina VCI, color y etiqueta), cada una con su regla de origen. */
    sugerencias: SugerenciasEspecificacion;
    pendientes: string[];
    advertencias: Advertencia[];
    /** La especificación todavía NO está confirmada: nada se ha guardado ni aprobado. */
    especificacionConfirmada: false;
  };
}

export interface BindRecentResponse {
  data: {
    items: NovedadProducto[];
    skip: number;
    limit: number;
    /** `skip` de la página siguiente de BIND, o null si ya no hay más (o se alcanzó el límite de exploración). */
    nextSkip: number | null;
    orden: 'CreationDate desc';
    generadoEn: string;
    desdeCache: boolean;
  };
}

/** Caché temporal y acotada de las páginas de novedades: pocas entradas, vida corta y un intervalo mínimo entre actualizaciones forzadas (no se almacena el catálogo). */
export const RECENT_CACHE_TTL_MS = 60_000;
export const RECENT_MIN_REFRESH_MS = 10_000;
export const RECENT_CACHE_MAX_ENTRIES = 8;
export const RECENT_DEFAULT_LIMIT = 30;
export const RECENT_MAX_LIMIT = 50;

interface RecentEntry { at: number; items: NovedadProducto[]; rawCount: number }

const MENSAJES = {
  notConfigured: 'La integración con BIND no está configurada.',
  auth: 'BIND rechazó las credenciales configuradas en el servidor.',
  rateLimited: 'BIND limitó temporalmente las consultas. Intenta de nuevo en unos minutos.',
  upstream: 'BIND no está disponible en este momento.',
  timeout: 'BIND tardó demasiado en responder.',
  invalid: 'BIND devolvió una respuesta no válida.',
  badRequest: 'BIND no aceptó la consulta de producto.'
};

/**
 * Consulta de productos de BIND para manufactura: solo lectura. No escribe en PostgreSQL (no depende de la base de datos) ni guarda productos o
 * especificaciones. Reutiliza `interpretarProductoBind` sin duplicar sus reglas.
 */
@Injectable()
export class BindProductsService {
  private readonly recentCache = new Map<string, RecentEntry>();
  private readonly recentInFlight = new Map<string, Promise<RecentEntry>>();

  constructor(private readonly client: BindErpClient) {}

  /**
   * Novedades del catálogo: UNA página de BIND ordenada por fecha de alta descendente (orden verificado por el cliente), clasificada con los intérpretes existentes. No descarga el
   * catálogo, no escribe en PostgreSQL y no afirma nada sobre si un producto ya tiene hoja. `refresh` fuerza la consulta a BIND, pero no antes de RECENT_MIN_REFRESH_MS.
   */
  async listRecent(skipRaw: unknown, limitRaw: unknown, refresh = false): Promise<BindRecentResponse> {
    const skip = skipRaw === undefined || skipRaw === '' ? 0 : Number(skipRaw);
    const limit = limitRaw === undefined || limitRaw === '' ? RECENT_DEFAULT_LIMIT : Number(limitRaw);
    if (!Number.isInteger(skip) || skip < 0 || skip > BIND_RECENT_MAX_SKIP || !Number.isInteger(limit) || limit < 1 || limit > Math.min(RECENT_MAX_LIMIT, BIND_RECENT_MAX_TOP)) {
      throw new BadRequestException({ code: 'BIND_INVALID_PAGE', message: `La página de novedades no es válida (skip 0–${BIND_RECENT_MAX_SKIP}, límite 1–${RECENT_MAX_LIMIT}).` });
    }
    const key = `${skip}:${limit}`;
    const ahora = Date.now();
    const cached = this.recentCache.get(key);
    const vigente = cached !== undefined && ahora - cached.at < (refresh ? RECENT_MIN_REFRESH_MS : RECENT_CACHE_TTL_MS);
    let entry = vigente ? cached : undefined;
    const desdeCache = entry !== undefined;
    if (entry === undefined) {
      let pendiente = this.recentInFlight.get(key);                              // solicitudes simultáneas iguales comparten una sola consulta a BIND
      if (pendiente === undefined) {
        pendiente = this.fetchRecent(skip, limit).finally(() => this.recentInFlight.delete(key));
        this.recentInFlight.set(key, pendiente);
      }
      entry = await pendiente;
      this.recentCache.delete(key);
      this.recentCache.set(key, entry);
      while (this.recentCache.size > RECENT_CACHE_MAX_ENTRIES) this.recentCache.delete(this.recentCache.keys().next().value as string);
    }
    const siguiente = skip + entry.rawCount;
    return { data: { items: entry.items, skip, limit, nextSkip: entry.rawCount === limit && siguiente <= BIND_RECENT_MAX_SKIP ? siguiente : null, orden: 'CreationDate desc', generadoEn: new Date(entry.at).toISOString(), desdeCache } };
  }

  private async fetchRecent(skip: number, limit: number): Promise<RecentEntry> {
    const result = await this.client.listRecent(skip, limit);
    if (result.kind !== 'RECENT') return this.resolve(result) as never;      // lanza la excepción HTTP correspondiente (sin datos de BIND ni credenciales)
    const ahora = Date.now();
    return { at: ahora, rawCount: result.products.length, items: result.products.map((p) => clasificarNovedad(p, ahora)) };
  }

  async lookupByCode(code: string): Promise<BindProductLookupResponse> {
    const limpio = typeof code === 'string' ? code.trim() : code;
    if (!isValidBindCode(limpio)) throw new BadRequestException({ code: 'BIND_INVALID_CODE', message: 'El código DCMX no es válido (letras, dígitos, punto, guion y guion bajo; máximo 64).' });
    return this.resolve(await this.client.findByCode(limpio));
  }

  async lookupById(id: string): Promise<BindProductLookupResponse> {
    const limpio = typeof id === 'string' ? id.trim() : id;
    if (!isValidBindId(limpio)) throw new BadRequestException({ code: 'BIND_INVALID_ID', message: 'El ID de BIND debe ser un GUID válido.' });
    return this.resolve(await this.client.findById(limpio));
  }

  private resolve(result: BindLookupResult): BindProductLookupResponse {
    switch (result.kind) {
      case 'RESULTS':
        return this.fromProducts(result.products);
      case 'NOT_CONFIGURED':
        throw new ServiceUnavailableException({ code: 'BIND_NOT_CONFIGURED', message: MENSAJES.notConfigured });
      case 'UNAUTHORIZED':
      case 'FORBIDDEN':
        // Credenciales del SERVIDOR rechazadas por BIND: no es un problema de la sesión del usuario (no se devuelve 401/403 al frontend).
        throw new BadGatewayException({ code: 'BIND_AUTH_FAILED', message: MENSAJES.auth });
      case 'RATE_LIMITED':
        throw new ServiceUnavailableException({ code: 'BIND_RATE_LIMITED', message: MENSAJES.rateLimited });
      case 'TIMEOUT':
        throw new GatewayTimeoutException({ code: 'BIND_TIMEOUT', message: MENSAJES.timeout });
      case 'BAD_REQUEST':
        throw new BadGatewayException({ code: 'BIND_REQUEST_REJECTED', message: MENSAJES.badRequest });
      case 'INVALID_RESPONSE':
        throw new BadGatewayException({ code: 'BIND_INVALID_RESPONSE', message: MENSAJES.invalid });
      case 'UPSTREAM_ERROR':
      case 'NETWORK_ERROR':
        throw new BadGatewayException({ code: 'BIND_UNAVAILABLE', message: MENSAJES.upstream });
    }
  }

  private fromProducts(products: BindProductRaw[]): BindProductLookupResponse {
    if (products.length === 0) throw new NotFoundException({ code: 'BIND_PRODUCT_NOT_FOUND', message: 'No se encontró el producto en BIND.' });
    if (products.length > 1) {
      // Varias coincidencias: no se elige una arbitrariamente. Solo se informa cuántas hay (sin datos de los productos).
      throw new ConflictException({ code: 'BIND_MULTIPLE_MATCHES', message: 'BIND devolvió varios productos para la consulta; se requiere un criterio único (ID).' });
    }
    const raw = products[0] as BindProductRaw;
    const producto: BindProductoOriginal = { ID: raw.ID, Code: raw.Code, Title: raw.Title, Description: raw.Description, Weight: raw.Weight, CreationDate: raw.CreationDate };
    const interpretacion = interpretarProductoBind(producto);
    const sugerencias = sugerirEspecificacion(interpretacion);
    return {
      data: {
        origen: 'BIND',
        producto,
        interpretacion,
        datosSugeridosPlantilla: sugerirDatosPlantilla(interpretacion),
        familiaSugerida: sugerencias.familia.valor === null ? [] : [sugerencias.familia.valor],
        sugerencias,
        pendientes: interpretacion.pendientes,
        advertencias: interpretacion.advertencias,
        especificacionConfirmada: false
      }
    };
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../../config/environment';

// Cliente HTTP de solo lectura de BIND ERP (https://developers.bind.com.mx/tutorials). Es el ÚNICO lugar de la API que habla con BIND. Igual que los demás clientes de
// integración del Hub (webhooks de n8n): fetch nativo, timeout acotado y resultados tipados; el cuerpo, la URL y los mensajes de BIND nunca llegan al llamador y las
// credenciales (BIND_API_KEY / BIND_SUBSCRIPTION_KEY) no se registran en ningún log. No escribe en PostgreSQL ni descarga el catálogo.

/** Campos de BIND que el Hub necesita; cualquier otro campo (costos, inventarios, precios) se descarta al leer la respuesta. */
export interface BindProductRaw {
  ID: string;
  Code: string;
  Title: string;
  Description: string | null;
  Weight: number | string | null;
  CreationDate: string | null;
}

export type BindLookupResult =
  | { kind: 'RESULTS'; products: BindProductRaw[] }
  | { kind: 'NOT_CONFIGURED' }
  | { kind: 'UNAUTHORIZED' }
  | { kind: 'FORBIDDEN' }
  | { kind: 'BAD_REQUEST' }
  | { kind: 'RATE_LIMITED'; retryAfterSeconds: number | null }
  | { kind: 'UPSTREAM_ERROR' }
  | { kind: 'TIMEOUT' }
  | { kind: 'NETWORK_ERROR' }
  | { kind: 'INVALID_RESPONSE' };

/** Novedades: una sola página de BIND ordenada por fecha de alta descendente, con orden verificado. */
export type BindRecentResult = { kind: 'RECENT'; products: BindProductRaw[] } | Exclude<BindLookupResult, { kind: 'RESULTS' }>;

/** Límites que BIND acepta ($top máximo 100, comprobado con la API real) y que el Hub se impone para no recorrer el catálogo. */
export const BIND_RECENT_MAX_TOP = 100;
export const BIND_RECENT_MAX_SKIP = 500;

export interface BindClientOptions {
  timeoutMs: number;
  totalTimeoutMs: number;
  /** Esperas antes de cada reintento (errores transitorios: 429, 5xx, red y timeout). Su longitud es el máximo de reintentos. */
  retryDelaysMs: number[];
  maxRetryAfterMs: number;
  maxPages: number;
}

export const BIND_CLIENT_OPTIONS = 'BIND_CLIENT_OPTIONS';
export const DEFAULT_BIND_CLIENT_OPTIONS: BindClientOptions = { timeoutMs: 10_000, totalTimeoutMs: 30_000, retryDelaysMs: [500, 1_500], maxRetryAfterMs: 5_000, maxPages: 3 };

const PRODUCTS_PATH = '/api/Products';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Código DCMX: letras, dígitos, punto, guion y guion bajo (sin comillas, espacios ni barras): se interpola en el $filter, por eso la lista es cerrada.
const CODE = /^[A-Za-z0-9._-]{1,64}$/;

export const isValidBindId = (value: unknown): value is string => typeof value === 'string' && GUID.test(value);
export const isValidBindCode = (value: unknown): value is string => typeof value === 'string' && CODE.test(value);

type PageOutcome = { kind: 'OK'; body: unknown } | Exclude<BindLookupResult, { kind: 'RESULTS' }>;

@Injectable()
export class BindErpClient {
  private readonly options: BindClientOptions;

  constructor(
    private readonly config: ConfigService<EnvironmentConfig, true>,
    @Optional() @Inject(BIND_CLIENT_OPTIONS) options?: Partial<BindClientOptions>
  ) {
    this.options = { ...DEFAULT_BIND_CLIENT_OPTIONS, ...options };
  }

  /** Búsqueda exacta por ID (GUID): `$filter=ID eq guid'…'`, la sintaxis documentada por BIND. */
  async findById(id: string): Promise<BindLookupResult> {
    if (!isValidBindId(id)) return { kind: 'BAD_REQUEST' };
    const normalizado = id.toLowerCase();
    return this.lookup(`ID eq guid'${normalizado}'`, (p) => p.ID.toLowerCase() === normalizado);
  }

  /**
   * Búsqueda exacta por Code: `$filter=Code eq '…'` (OData). La documentación pública de BIND no detalla los operadores para propiedades de texto (su tabla de
   * operadores es una imagen): la sintaxis debe comprobarse con la prueba real (ver README). Si BIND rechaza el filtro (400) el resultado es BAD_REQUEST; si lo
   * ignora y devuelve otros productos, se detecta (INVALID_RESPONSE) y nunca se elige un producto distinto del solicitado.
   */
  async findByCode(code: string): Promise<BindLookupResult> {
    if (!isValidBindCode(code)) return { kind: 'BAD_REQUEST' };
    const buscado = code.trim().toLowerCase();
    return this.lookup(`Code eq '${code}'`, (p) => p.Code.trim().toLowerCase() === buscado);
  }

  /**
   * Productos más recientes: `$orderby=CreationDate desc&$top=N&$skip=M` (sintaxis comprobada con la API real de BIND; `$top` máximo 100). Una sola página por llamada, nunca
   * se descarga el catálogo. Si BIND no devolviera la página realmente ordenada por fecha de alta, el resultado es INVALID_RESPONSE: no se presentan productos como «recientes»
   * sin poder comprobarlo.
   */
  async listRecent(skip: number, top: number): Promise<BindRecentResult> {
    if (!Number.isInteger(skip) || !Number.isInteger(top) || skip < 0 || skip > BIND_RECENT_MAX_SKIP || top < 1 || top > BIND_RECENT_MAX_TOP) return { kind: 'BAD_REQUEST' };
    const { baseUrl, apiKey, subscriptionKey } = this.config.get('bind', { infer: true });
    if (!apiKey) return { kind: 'NOT_CONFIGURED' };
    const base = new URL(baseUrl);
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
    if (subscriptionKey) headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;
    const url = `${base.origin}${PRODUCTS_PATH}?$orderby=${encodeURIComponent('CreationDate desc')}&$top=${top}&$skip=${skip}`;
    const page = await this.requestWithRetries(url, headers, Date.now() + this.options.totalTimeoutMs);
    if (page.kind !== 'OK') return page;
    const parsed = parsePage(page.body);
    if (parsed === null || parsed.products.length > top) return { kind: 'INVALID_RESPONSE' };
    let anterior = Number.POSITIVE_INFINITY;
    for (const p of parsed.products) {
      if (p.CreationDate === null) continue;
      const t = Date.parse(p.CreationDate);
      if (Number.isNaN(t) || t > anterior) return { kind: 'INVALID_RESPONSE' };
      anterior = t;
    }
    return { kind: 'RECENT', products: parsed.products };
  }

  private async lookup(filter: string, coincide: (p: BindProductRaw) => boolean): Promise<BindLookupResult> {
    const { baseUrl, apiKey, subscriptionKey } = this.config.get('bind', { infer: true });
    if (!apiKey) return { kind: 'NOT_CONFIGURED' };

    const base = new URL(baseUrl);
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
    if (subscriptionKey) headers['Ocp-Apim-Subscription-Key'] = subscriptionKey;

    const deadline = Date.now() + this.options.totalTimeoutMs;
    const recibidos: BindProductRaw[] = [];
    // El espacio y las comillas del $filter se codifican explícitamente (%20, %27): sin concatenar entradas sin validar.
    let url: string | null = `${base.origin}${PRODUCTS_PATH}?$filter=${encodeURIComponent(filter)}`;
    let paginas = 0;
    let descartados = 0;

    while (url !== null && paginas < this.options.maxPages) {
      paginas += 1;
      const page = await this.requestWithRetries(url, headers, deadline);
      if (page.kind !== 'OK') return page;
      const parsed = parsePage(page.body);
      if (parsed === null) return { kind: 'INVALID_RESPONSE' };
      for (const producto of parsed.products) {
        if (coincide(producto)) recibidos.push(producto);
        else descartados += 1;
      }
      // Un filtro exacto debería devolver 0 o 1 producto: con 2 o más coincidencias ya es ambiguo y no se sigue paginando.
      if (recibidos.length >= 2) break;
      url = parsed.nextLink === null ? null : validateNextLink(parsed.nextLink, base, url);
      if (parsed.nextLink !== null && url === null) return { kind: 'INVALID_RESPONSE' };
    }
    // Si BIND ignoró el filtro (devolvió productos pero ninguno es el solicitado) no se oculta como «no encontrado».
    if (recibidos.length === 0 && descartados > 0) return { kind: 'INVALID_RESPONSE' };
    return { kind: 'RESULTS', products: recibidos };
  }

  private async requestWithRetries(url: string, headers: Record<string, string>, deadline: number): Promise<PageOutcome> {
    let ultimo: PageOutcome = { kind: 'NETWORK_ERROR' };
    for (let intento = 0; intento <= this.options.retryDelaysMs.length; intento += 1) {
      const restante = deadline - Date.now();
      if (restante <= 0) return { kind: 'TIMEOUT' };
      ultimo = await this.requestOnce(url, headers, Math.min(this.options.timeoutMs, restante));
      // Solo los errores transitorios se reintentan; 400, 401, 403 y respuestas inválidas nunca.
      const transitorio = ultimo.kind === 'RATE_LIMITED' || ultimo.kind === 'UPSTREAM_ERROR' || ultimo.kind === 'TIMEOUT' || ultimo.kind === 'NETWORK_ERROR';
      if (!transitorio || intento === this.options.retryDelaysMs.length) return ultimo;
      let espera = this.options.retryDelaysMs[intento] as number;
      if (ultimo.kind === 'RATE_LIMITED' && ultimo.retryAfterSeconds !== null) espera = Math.min(ultimo.retryAfterSeconds * 1000, this.options.maxRetryAfterMs);
      if (Date.now() + espera >= deadline) return ultimo;
      await new Promise((resolve) => setTimeout(resolve, espera));
    }
    return ultimo;
  }

  private async requestOnce(url: string, headers: Record<string, string>, timeoutMs: number): Promise<PageOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
    } catch {
      // Sanitizado: ni el error subyacente, ni la URL, ni las credenciales llegan al llamador. Solo se distingue el timeout.
      clearTimeout(timer);
      return controller.signal.aborted ? { kind: 'TIMEOUT' } : { kind: 'NETWORK_ERROR' };
    }
    clearTimeout(timer);
    const status = response.status;
    if (status >= 200 && status < 300) {
      try {
        return { kind: 'OK', body: await response.json() };
      } catch {
        return { kind: 'INVALID_RESPONSE' };
      }
    }
    if (status === 401) return { kind: 'UNAUTHORIZED' };
    if (status === 403) return { kind: 'FORBIDDEN' };
    if (status === 429) return { kind: 'RATE_LIMITED', retryAfterSeconds: parseRetryAfter(response.headers?.get?.('retry-after') ?? null) };
    if (status === 408 || status >= 500) return { kind: 'UPSTREAM_ERROR' };
    return { kind: 'BAD_REQUEST' };
  }
}

function parseRetryAfter(valor: string | null): number | null {
  if (valor === null || !/^\d{1,4}$/.test(valor.trim())) return null;
  return Number(valor.trim());
}

/** nextLink solo se sigue si permanece en el host de BIND configurado, por HTTPS, en /api/Products y sin credenciales embebidas. */
function validateNextLink(nextLink: string, base: URL, actual: string): string | null {
  let destino: URL;
  try {
    destino = new URL(nextLink, base);
  } catch {
    return null;
  }
  if (destino.protocol !== 'https:' || destino.hostname !== base.hostname || destino.port !== '' || destino.username !== '' || destino.password !== '') return null;
  if (!destino.pathname.toLowerCase().startsWith(PRODUCTS_PATH.toLowerCase())) return null;
  return destino.href === actual ? null : destino.href;
}

function textoONulo(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

/** Extrae `value` (o un arreglo directo) y proyecta solo los seis campos permitidos; cualquier forma inesperada devuelve null (respuesta inválida). */
function parsePage(body: unknown): { products: BindProductRaw[]; nextLink: string | null } | null {
  const lista = Array.isArray(body) ? body : typeof body === 'object' && body !== null ? (body as { value?: unknown }).value : undefined;
  if (!Array.isArray(lista)) return null;
  const nextLinkBruto = !Array.isArray(body) && typeof body === 'object' && body !== null ? (body as { nextLink?: unknown }).nextLink : undefined;
  if (nextLinkBruto !== undefined && nextLinkBruto !== null && typeof nextLinkBruto !== 'string') return null;
  const products: BindProductRaw[] = [];
  for (const item of lista) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    if (typeof o.ID !== 'string' || typeof o.Code !== 'string' || typeof o.Title !== 'string') return null;
    const peso = o.Weight;
    if (peso !== undefined && peso !== null && typeof peso !== 'number' && typeof peso !== 'string') return null;
    products.push({ ID: o.ID, Code: o.Code, Title: o.Title, Description: textoONulo(o.Description), Weight: peso ?? null, CreationDate: textoONulo(o.CreationDate) });
  }
  return { products, nextLink: typeof nextLinkBruto === 'string' && nextLinkBruto !== '' ? nextLinkBruto : null };
}

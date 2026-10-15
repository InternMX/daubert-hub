import { BadGatewayException, BadRequestException, ConflictException, GatewayTimeoutException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { interpretarProductoBind, sugerirDatosPlantilla } from '../bind-product-interpreter';
import type { Advertencia, FamiliaPosible, ResultadoInterpretacion } from '../bind-product-interpreter';
import { BindErpClient, isValidBindCode, isValidBindId } from './bind-erp.client';
import type { BindLookupResult, BindProductRaw } from './bind-erp.client';

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
    /** Pista no vinculante: la familia la selecciona el usuario. */
    familiaSugerida: FamiliaPosible[];
    pendientes: string[];
    advertencias: Advertencia[];
    /** La especificación todavía NO está confirmada: nada se ha guardado ni aprobado. */
    especificacionConfirmada: false;
  };
}

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
  constructor(private readonly client: BindErpClient) {}

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
    return {
      data: {
        origen: 'BIND',
        producto,
        interpretacion,
        datosSugeridosPlantilla: sugerirDatosPlantilla(interpretacion),
        familiaSugerida: interpretacion.familia.posiblesEstaFase,
        pendientes: interpretacion.pendientes,
        advertencias: interpretacion.advertencias,
        especificacionConfirmada: false
      }
    };
  }
}

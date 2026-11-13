import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Los 400 de validación del gestor documental indican QUÉ CAMPOS se rechazaron (solo sus nombres, nunca los valores ni los textos de la validación), para que la pantalla pueda decir
 * «revisa el campo X» en vez de un genérico «solicitud no válida». Es local a este controlador: el filtro global sigue colapsando los demás.
 */
const CAMPO = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d+\])*$/;

/** Extrae el nombre del campo de los mensajes de class-validator («datos.pesoLb must be…», «property x should not exist») y de los del servicio («datos.ancho»). */
export function campoDeMensaje(mensaje: string): string | null {
  const candidatos = [/^property ([^\s]+) should not exist/.exec(mensaje)?.[1], /«([^»]+)»/.exec(mensaje)?.[1], /^([^\s]+) (?:must|should|has|is|contains|cannot|can|each)\b/.exec(mensaje)?.[1]];
  return candidatos.find((c): c is string => c !== undefined && CAMPO.test(c)) ?? null;
}

@Catch(BadRequestException)
export class DetalleValidacionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const payload = exception.getResponse();
    const mensajes = typeof payload === 'object' && payload !== null && 'message' in payload ? [(payload as { message: unknown }).message].flat() : [payload];
    const campos = [...new Set(mensajes.filter((m): m is string => typeof m === 'string').map(campoDeMensaje).filter((c): c is string => c !== null))].slice(0, 10);
    host.switchToHttp().getResponse<Response>().status(400).json({ statusCode: 400, code: 'INVALID_DATA', message: 'Solicitud no válida.', ...(campos.length > 0 ? { fields: campos } : {}) });
  }
}

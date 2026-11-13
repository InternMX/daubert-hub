import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../config/environment';

/**
 * Habilitación explícita de Manufactura (sustituye al antiguo TestOnlyGuard, que la limitaba a la base de TEST por nombre).
 * Aunque el módulo esté registrado, si el entorno no la habilita (ver resolveManufacturing en config/environment.ts) la ruta responde 404, como si no existiera, sin
 * consultar la base ni revelar nada. Se evalúa en cada solicitud, DESPUÉS de los guards globales de sesión, CSRF y roles: habilitar el módulo nunca sustituye la autenticación.
 */
@Injectable()
export class ManufacturingEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  canActivate(): boolean {
    if (!this.config.get('manufacturing', { infer: true })?.enabled) throw new NotFoundException();
    return true;
  }
}

/**
 * Para las rutas de Manufactura que no usan el esquema `manufactura` (búsqueda en BIND, familias y vista previa). Conserva su disponibilidad en cualquier base de
 * desarrollo, pero en la base de PRODUCCIÓN responde 404 mientras el módulo no esté habilitado explícitamente.
 */
@Injectable()
export class ManufacturingSheetsEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  canActivate(): boolean {
    const manufacturing = this.config.get('manufacturing', { infer: true });
    if (manufacturing?.emission === 'PRODUCCION' && !manufacturing.enabled) throw new NotFoundException();
    return true;
  }
}

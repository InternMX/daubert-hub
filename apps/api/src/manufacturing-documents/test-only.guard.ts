import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentConfig } from '../config/environment';

/** Única base en la que existe el esquema `manufactura` y en la que el gestor documental puede funcionar. */
export const BASE_TEST_DOCUMENTAL = 'daubert_hub_test';

/**
 * El gestor documental es SOLO de TEST. Aunque el módulo esté registrado, cualquier ejecución cuya base configurada no sea `daubert_hub_test` responde 404 (como si la ruta no existiera),
 * sin consultar la base ni revelar nada. Se evalúa en cada solicitud, después de los guards globales de sesión y CSRF.
 */
@Injectable()
export class TestOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentConfig, true>) {}

  canActivate(): boolean {
    if (this.config.get('database', { infer: true }).name !== BASE_TEST_DOCUMENTAL) throw new NotFoundException();
    return true;
  }
}

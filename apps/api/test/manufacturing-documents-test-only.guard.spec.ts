import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { EnvironmentConfig } from '../src/config/environment';
import { TestOnlyGuard } from '../src/manufacturing-documents/test-only.guard';

const guardPara = (name: string): TestOnlyGuard => new TestOnlyGuard({ get: () => ({ name }) } as unknown as ConfigService<EnvironmentConfig, true>);

describe('TestOnlyGuard del gestor documental', () => {
  it('permite las rutas solo cuando la base configurada es daubert_hub_test', () => {
    expect(guardPara('daubert_hub_test').canActivate()).toBe(true);
  });
  it.each(['daubert_global', 'otra_base', ''])('responde 404 (como si la ruta no existiera) con la base «%s»', (base) => {
    expect(() => guardPara(base).canActivate()).toThrow(NotFoundException);
  });
});

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(async () => {
  const { marcarManufacturaDisponibleParaPruebas } = await import('../manufacturing/manufacturaDisponible');
  marcarManufacturaDisponibleParaPruebas();
});
afterEach(() => cleanup());

import { ValidationPipe } from '@nestjs/common';

/**
 * Configuración EFECTIVA de validación/transformación de DTO de toda la API. Es la única fuente: la usan `main.ts` y las pruebas HTTP, de modo que lo que se prueba es lo que corre
 * (transform: convierte y aplica @Transform; whitelist + forbidNonWhitelisted: rechaza propiedades desconocidas con 400).
 */
export const createGlobalValidationPipe = (): ValidationPipe => new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

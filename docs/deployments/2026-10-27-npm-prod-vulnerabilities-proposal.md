# Propuesta: vulnerabilidades npm de producción (API) – 2026-10-27

**Propuesta, no aplicada.** No se modificó `package.json` ni `package-lock.json` de esta rama por este motivo. Las pruebas se hicieron en una copia desechable fuera del repositorio. Complementa [la nota del despliegue conjunto](2026-10-27-hub-pagos-caterpillar-joint-prod.md#advertencias-de-dependencias-npm).

## Alcance

`npm audit --omit=dev` sobre el lock de `f099e31` (igual en esta rama): **4 vulnerabilidades** (3 altas, 1 moderada), todas en la cadena `@nestjs/platform-express` → `express`/`multer` de la API.

| Paquete | Instalado | Rango afectado | Aviso | Versión corregida | ¿Cómo se llega? |
| --- | --- | --- | --- | --- | --- |
| `body-parser` | 2.3.0 | 2.0.0 – 2.3.0 | DoS por bytes tras un cuerpo comprimido ([GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)) | **2.4.0** | Dependencia de `express@5.2.1` con rango `^2.2.1`: **se corrige solo con el lock** |
| `qs` | 6.16.0 | 6.7.0 – 6.16.0 | DoS en `qs.stringify` con `arrayFormat: 'comma'` ([GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw)) | **6.17.0** (publicada; ≥ 6.16.1) | `express` (`^6.14.0`) y `body-parser`: **se corrige solo con el lock** |
| `multer` | 2.4.0 | 2.0.0 – 2.4.0 | DoS por `fileFilter` asíncrono pendiente tras cerrar la petición ([GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)) | **2.5.0** | `@nestjs/platform-express@11.2.7` y `11.2.8` lo **fijan exactamente en `2.4.0`**: no se corrige con el lock |
| `@nestjs/platform-express` | 11.2.7 | 11.1.2 – 12.2.0 | afectado solo por la dependencia `multer` | 12.3.2 (**mayor**) | `npm audit` sugiere el salto a NestJS 12; la rama 11.x no tiene versión corregida (la última, 11.2.8, sigue fijando `multer@2.4.0`) |

### Exposición real en este código

- `multer`: **ninguna ruta de la API lo usa** (no hay `FileInterceptor`/`FilesInterceptor` en `apps/api/src`). Está instalado como dependencia de `platform-express`, pero el código vulnerable no se ejecuta. Riesgo bajo, corrección conveniente.
- `body-parser`: Nest lo usa para todo cuerpo JSON y se ejecuta antes de la autenticación; el vector exige peticiones con cuerpo comprimido. La API solo atiende la red interna detrás de Nginx. Riesgo bajo-medio.
- `qs`: lo usa el parser de consultas de Express; el aviso afecta a `stringify`, que el código no invoca. Riesgo bajo.

## Opciones

| | Cambio | Resuelve | Riesgo |
| --- | --- | --- | --- |
| **A. Actualización de lock dentro del rango** | `npm update body-parser qs` (solo `package-lock.json`) | `body-parser`, `qs` | Mínimo: mismos rangos que declara `express`; precedente en el PR #5 / v1.0.6 |
| **B. Override de `multer`** | `"overrides": { "@nestjs/platform-express": { "multer": "2.5.0" } }` en el `package.json` raíz, y luego `npm update multer` | `multer` y, con él, `platform-express` | Bajo: es la misma versión de `multer` que usa NestJS 12 (`platform-express@12.3.2`); el código no usa `multer`. Es una divergencia de lo que Nest 11 declara, hay que revertirla cuando salga un 11.x corregido |
| **C. NestJS 12** | `@nestjs/{common,core,platform-express}@^12` y revisar el resto del ecosistema (`@nestjs/config`, testing, etc.) | todo, vía `express@5.3.0` | Alto: salto mayor, requiere migración y pruebas de regresión completas; no recomendado como corrección de seguridad urgente |

**Recomendación: A + B en un PR propio**, solo API, sin tocar NestJS. Dejar C para una actualización planificada.

## Evidencia (copia desechable de esta rama, LF, fuera del repositorio)

Pasos: `npm ci`; `npm update body-parser qs`; agregar el override; `npm update multer`.

| Comprobación | Resultado |
| --- | --- |
| Versiones resueltas | `body-parser 2.4.0`, `qs 6.17.0`, `multer 2.5.0` (`express 5.2.1` y `@nestjs/platform-express 11.2.7` sin cambio) |
| `npm audit --omit=dev` | **0 vulnerabilidades** (antes 4) |
| `npm audit` completo | 10 (antes 14): solo desarrollo/pruebas |
| `typecheck`, `lint`, `build` de la API | OK |
| Pruebas de la API (`npm run test:api`, con variables `DB_*` ficticias) | 150/150 archivos, 2426/2426 pruebas |
| Cambios en el lock | solo tres entradas: `body-parser`, `qs`, `multer` (`version`/`resolved`/`integrity`) y el `overrides` en el `package.json` |

Dos advertencias de método:
- **npm 12.0.2 no aplica un `override` nuevo sobre un lock existente** con `npm install`/`--package-lock-only` (informa `invalid` o deja el lock inconsistente). Hay que ejecutar `npm update multer` después de añadirlo. Verificar siempre con `npm ls --omit=dev multer` y `npm audit --omit=dev` y comprobar que el lock no pierda la entrada `node_modules/multer`.
- No se probó el flujo completo con PostgreSQL ni la Web con estas versiones. Las pruebas de integración de la API (`npm run test:integration`) requieren una base de datos y no se ejecutaron.

## Plan de aplicación (futuro, con autorización)

1. Rama nueva desde `main`; aplicar A + B; verificar que el diff de `package-lock.json` toque solo `body-parser`, `qs` y `multer`.
2. `npm ci`, `npm run validate` (incluye `test:integration` contra una base de pruebas) y las pruebas de Caterpillar/Pagos.
3. Despliegue solo de la API (`Deploy-DaubertHub.ps1`, como en la v1.0.6) y comprobación de `/api/health`.
4. Sin cambios en n8n, PostgreSQL ni Nginx. Rollback: ancla `rollback-<commit>` de la API.

## Vulnerabilidades solo de desarrollo (no incluidas en la imagen)

Quedan `vitest`, `@vitest/*`, `tinypool`, `vite`, `shell-quote`, `js-yaml`, `brace-expansion`, `fast-uri` y `source-map-js`. Varias se corrigen sin cambio mayor con `npm audit fix` (sin `--force`); `vitest`, `tinypool` y `@vitest/*` sugieren `vitest@5.0.5` (mayor). Tratarlo en una ventana de mantenimiento de herramientas, por separado.

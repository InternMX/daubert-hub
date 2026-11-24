# Incremento 0 · Fundamentos y riesgos actuales

- **Status:** Propuesto.
- **Fecha:** 2026-11-24
- Parte del [roadmap](README.md#roadmap). Arquitectura en [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md).

**Objetivo:** dejar decidida y documentada la arquitectura, despejar la incertidumbre técnica del journal (J1), corregir los defectos de seguridad de las herramientas actuales y tratar los riesgos operativos OR-1, OR-2, OR-4 y OR-5. **No se implementa el motor.** No hay ningún cambio en PROD ni en TEST salvo los que ejecute el operador según los planes 0R/0b.

## Bloques

| Bloque | Contenido | Ejecuta | Revisa | Cierre |
|---|---|---|---|---|
| **0d · Documentación** | ADR-006, modelo de capacidades y compuertas, registro de riesgos, planes OR-1/OR-2, este documento, plan J1 | Claude | Operador (+ Codex opcional) | Aprobación del operador y merge |
| **0R · Riesgos actuales** | [OR-1](remediation-or1-or2.md#or-1--custodia-de-la-identidad-age) Fases 0–4 (5 condicional); [OR-2](remediation-or1-or2.md#or-2--dependencia-de-prod-del-inicio-de-sesión) Fases 0–2 | **Operador** | Claude verifica en lectura | Nota de evidencia por fase |
| **0c · J1** | PoC del journal según el [plan J1](j1-journal-test-plan.md) | Codex implementa, Claude revisa y re-ejecuta | Operador | Informe J1 con P1–P12 superadas y P13a–c documentadas |
| **0a · 7 PR independientes** | Correcciones de las herramientas actuales (§0a) | Codex implementa, Claude revisa | Codex (revisión independiente) + operador | CI verde y merge, uno cada vez |
| **0b · Host** | Clon operativo independiente, migración `daubert-ai` M0–M3, causa del reinicio | **Operador** | Claude verifica en lectura | Lista de verificación y pruebas negativas |

## Orden y dependencias

1. **0d** primero (este PR).
2. **OR-1 Fase 0 y OR-2 Fase 0** en paralelo con 0c: son solo lectura y de máxima prioridad.
3. **0c (J1)** en paralelo con 0R: no toca el host más allá de una carpeta temporal.
4. **0a** después de J1 o en paralelo, **un PR cada vez**. PR-1 primero (riesgo de seguridad activo).
5. **0b**: el clon operativo y M0–M1 pueden avanzar antes; las denegaciones de M2 sobre `RECOVERY\KEYS` esperan a OR-1 Fase 3.
6. Las correcciones de 0a **no llegan al checkout operativo** hasta que exista el clon independiente (0b) y una release supervisada las incorpore.

## 0a · PR independientes

Cada PR: rama propia desde `main`, regresiones Pester que fallan sin el cambio y pasan con él, revisión independiente de Codex, sin cambios de comportamiento fuera de su alcance.

| PR | Cambio | Archivo(s) | Criterio de aceptación |
|---|---|---|---|
| **PR-1** | `Get-State`: un fallo de transporte devuelve `UNKNOWN`, nunca `OPEN`. | `Set-EntryClosure.ps1` | Prueba con sondas simuladas: timeout, conexión rechazada y error DNS → `UNKNOWN`; 503 → `CLOSED`; 200 → `OPEN`. Los llamadores tratan `UNKNOWN` como fallo. |
| **PR-2** | Switch `-Disable`: confirmación interactiva (frase) y compuertas documentadas. | `Switch-Manufactura.ps1` | Sin frase → no hay efecto y el código de salida está documentado; con frase → comportamiento actual. |
| **PR-3** | Switch sin `-Apply`: la evaluación no escribe metadatos de lock. | `Switch-Manufactura.ps1`, `DaubertOps.Common.psm1` si aplica | Ejecución de plan → `operacion.lock` sin cambios (hash y mtime). |
| **PR-4** | Deploy: la promoción parcial de etiquetas deja un estado explícito y un código de salida propio. | `Deploy-DaubertHub.ps1` | Fallo simulado tras la primera etiqueta → estado `PartialTagPromotion` en la evidencia, código distinto de 1, sin `compose up`. |
| **PR-5** | Parametrizar las raíces fijas (`C:\Users\06\...`) con **valores por defecto idénticos** a los actuales. | `DaubertOps.Common.psm1`, `Deploy-DaubertHub.ps1`, `Switch-Manufactura.ps1`, `Set-EntryClosure.ps1` | Sin parámetros, comportamiento idéntico; prueba de portabilidad que falla si aparece `C:\Users\` fuera de los valores por defecto declarados. |
| **PR-6** | Parámetro explícito de endpoint Docker, manteniendo el veto a `DOCKER_HOST`/`DOCKER_CONTEXT` ambientales. | `DaubertOps.Common.psm1` y llamadores | El endpoint ambiental sigue vetado; el explícito se registra en la evidencia; sin parámetro, el comportamiento es idéntico. |
| **PR-7** | Cabecera de contrato (`contract: <nombre>/<versión>`) y tabla de códigos de salida legible por máquina en cada script. | Scripts de `scripts/deploy` y `scripts/release` | Prueba que verifica que cada código que el script puede devolver está en su tabla y viceversa. |

## 0b · Host (ejecuta el operador)

1. **Clon operativo independiente (OR-5).**
   - Antes: inventariar los archivos no versionados del checkout actual (`pilot.prod.env`, `compose.prod-temp.yaml` y cualquier otro), solo por nombre y hash.
   - Crear un clon nuevo (no un worktree) en una ubicación fuera de perfiles de usuario, fijado al commit que se decida en la próxima release supervisada.
   - **Conservar el checkout antiguo** sin cambios hasta que una release supervisada use el nuevo.
2. **Migración `daubert-ai` M0–M3 (OR-4).**
   - M0 inventario de lo que usan los agentes (repositorios, credenciales de `gh`/Git, configuración de Claude y Codex).
   - M1 cuenta estándar `daubert-ai`, grupo `DaubertDev`, directorio de desarrollo fuera de perfiles de usuario con clones nuevos.
   - M2 denegaciones explícitas: clon operativo, `pilot.prod.env`, raíz operativa, `%ProgramData%\DaubertHub\Orchestrator`, secretos de respaldo, `RECOVERY\KEYS`.
   - M3 ejecución en paralelo con pruebas negativas: `docker ps` falla, no se leen `pilot.prod.env` ni la clave, no se escribe en el estado del orquestador. Incluye la prueba negativa pendiente de acceso de `CodexSandbox*` al motor Docker.
   - M4 (corte) queda para el incremento 5 (G-C3).
   - Reversión: hasta M4 no se retira nada; basta seguir trabajando como `06`.
3. **Causa del reinicio** (OR-2 Fase 0).

## Criterios de salida del incremento 0

1. ADR-006 y documentos de `docs/orchestrator/` aprobados y fusionados.
2. Informe J1: decisión de exclusión (A o B), resultados P1–P12 medidos, P13a–c documentadas y RA-1 listo para aceptación. Si J1 falla, DF-04 revisada antes de empezar el incremento 1.
3. Los 7 PR de 0a fusionados con CI verde.
4. OR-1 Fase 0 ejecutada y Fases 1–3 ejecutadas en una estación independiente; **si no hay estación disponible, se registra el aplazamiento** y OR-1, NB-6 y G-C2 siguen abiertos (no bloquea los incrementos 1–3). OR-2 Fases 0–1 ejecutadas y proveedor de monitoreo externo seleccionado.
5. 0b: clon independiente creado; `daubert-ai` en M3 con pruebas negativas superadas.

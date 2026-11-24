# Registro de riesgos del orquestador

- **Status:** Propuesto. Ningún riesgo de este registro está **aceptado** todavía: cada aceptación es individual (NB-7) y la registra el operador cambiando el campo *Aceptación* en un PR.
- **Fecha:** 2026-11-24
- Desarrolla [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md). Compuertas y clases en el [modelo de capacidades](capabilities-and-gates.md).

Convenciones: **[F]** hecho verificado, **[H]** hipótesis, **[R]** recomendación.

## 1. Riesgos aceptables con compensación (RA)

Una capacidad solo sube de modo cuando todos sus RA tienen *Aceptación* con fecha y responsable.

| ID | Riesgo | Compensación | Capacidad afectada | Evidencia | Responsable | Revisión | Aceptación |
|---|---|---|---|---|---|---|---|
| **RA-1** | No se demuestra empíricamente la durabilidad del journal ante cortes de energía o caídas del SO. La cadena de hashes **no detecta** el truncamiento limpio de los últimos registros (ADR-006, §Garantías). | J1-P13a–c. La reconciliación observa el estado real y no confía en la ausencia de registros: evidencia insuficiente → `Uncertain` + `Suspended` + reconciliación humana (P-B). Rastros externos (anclas, logs, eventos Docker) contrastados. | C1 y superiores | Informe J1 | Operador | Cuando exista laboratorio (P13d) | Pendiente |
| **RA-2** | Fallos del motor Docker a mitad de una operación no probados. | Motor no disponible → paso `Uncertain`; al volver, se observa. C3 guiado en PROD hasta G-C3; C4 siempre guiado. | C2–C4 | — | Operador | Laboratorio o primer incidente real | Pendiente |
| **RA-3** | TEST no reproduce del todo PROD (bind mounts, políticas, datos). | Snapshot y plan de PROD en solo lectura antes de cada ventana; diferencias de perfil declaradas y revisadas en el plan. | C3 | Plan por release | Operador | Por release | Pendiente |
| **RA-4** | Las pruebas V2/V3 consumen recursos del host de PROD. | Restricciones preventivas (alcance, lista negra, compuerta de recursos, ventana, aprobación específica) + huella de PROD como detección. | V2, V3 | Pruebas negativas NB-3 | Operador | Trimestral | Pendiente |
| **RA-5** | Un holder colgado bloquea el lock indefinidamente. | Bloqueo seguro: diagnóstico con metadatos del holder; terminación manual por el operador. El lock nunca se roba. | Todas | J1-P3 | Operador | — | Pendiente |
| **RA-6** | En modo guiado, el comando realmente ejecutado no queda verificado. | Poscondiciones observadas; discrepancia → `Diverged`; indeterminado → `Uncertain`. | C3, C4 en guiado | Ensayo guiado V3 | Operador | — | Pendiente |

## 2. Restricciones bloqueantes (NB)

No se aceptan como riesgo; son condiciones técnicas que el registro de compuertas aplica.

| ID | Restricción | Cómo se verifica |
|---|---|---|
| **NB-1** | Ningún paso C3 supervisado en PROD sin toda la evidencia de C3 y G-C3 (auditoría de Codex + GO del operador). | Prueba negativa del registro de compuertas. |
| **NB-2** | Ninguna capacidad C4 ejecutada por el motor sin laboratorio o ADR específico con evidencia equivalente y doble aprobación. | `maxMode` de C4 = `guided` en todos los entornos. |
| **NB-3** | Ningún paso mutante en V2/V3 sin restricciones preventivas (alcance, lista negra, recursos) **comprobadas antes** del paso, aprobación específica de la prueba y huella de PROD activa; todas probadas en V0/V1. Ninguna prueba que pueda afectar al motor Docker compartido o a servicios productivos (P-A). | Pruebas negativas V0/V1 de cada restricción. |
| **NB-4** | No se usa el orquestador en PROD, ni en solo lectura, sin AC1 demostrado en V3. | G-C0. |
| **NB-5** | Ningún modo supervisado en PROD mientras los agentes de IA tengan acceso a Docker de PROD (OR-4). El modo guiado sí, porque el efecto lo ejecuta el operador. | Pruebas negativas M3 (`docker ps` falla como `daubert-ai`). |
| **NB-6** | El motor no ejecuta verificaciones de restauración mientras la identidad age sea legible por cuentas de agentes o de sandbox (OR-1). | Verificación de ACL (solo metadatos) en el snapshot. |
| **NB-7** | No se acepta el riesgo "en general". Cada aceptación registra ID, capacidad, compensación, evidencia, responsable y fecha o evento de revisión. | Regla 3 del registro de compuertas. |

## 3. Riesgos operativos actuales (OR)

Existen hoy, con o sin orquestador. Planes en [remediation-or1-or2.md](remediation-or1-or2.md); los ejecuta el operador.

| ID | Prioridad | Riesgo | Estado | Plan |
|---|---|---|---|---|
| **OR-1** | 🔴 | **[F]** La identidad age `daubert-backup-age-identity.age` (374 bytes) está en una carpeta sincronizada con Dropbox junto a la infraestructura de recuperación y es legible por herencia por `CodexSandboxUsers` (ReadAndExecute). **[H]** Protegida con frase de paso (pendiente de confirmar por el operador). La documentación de respaldos supone que la privada **no** está en el host productor. | Abierto | [OR-1](remediation-or1-or2.md#or-1--custodia-de-la-identidad-age) |
| **OR-2** | 🔴 | **[F]** Docker Desktop arranca al iniciar sesión `06`; `AutoAdminLogon=0`. Tras cualquier reinicio, PROD queda caído hasta un inicio de sesión. Causa del reinicio del 2026-11-24 sin determinar. | Abierto | [OR-2](remediation-or1-or2.md#or-2--dependencia-de-prod-del-inicio-de-sesión) |
| **OR-4** | 🟠 | **[F]** Los agentes de IA corren como `06`, con acceso al motor Docker de PROD y a `pilot.prod.env`. | Abierto | Migración `daubert-ai` M0–M4 ([incremento 0b](increment-0.md#0b--host-ejecuta-el-operador)) |
| **OR-5** | 🟠 | **[F]** El checkout operativo `daubert-hub-deploy-main` es uno de unos 40 worktrees del repositorio de desarrollo y comparte `.git`. Una operación de desarrollo (p. ej. `git fetch`, `gc`, `worktree prune`) afecta a sus metadatos. Está en `631e3a0`, sin el PR #45 ni el #47. | Abierto | Clon independiente ([incremento 0b](increment-0.md#0b--host-ejecuta-el-operador)) |
| **OR-3** | 🟡 | **[F]** Unas 36 anclas `rollback-*` de PROD sin uso; un `docker image prune -a` las borraría. | Abierto | Prohibición documentada; invariante DF-14 en el snapshot; política de retención de anclas como C3 futura. |

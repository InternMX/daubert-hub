# ADR-006 Arquitectura del Daubert Hub Update Orchestrator

- **Status:** Propuesto (arquitectura aprobada conceptualmente por el operador el 2026-11-24; pendiente de revisión del texto). DF-04 queda **condicionada** al resultado de J1.
- **Fecha:** 2026-11-24

A diferencia de ADR-001…005, este ADR **no es retroactivo**: documenta una decisión de diseño previa a la implementación. Se apoya en evidencia del sistema actual (scripts de `scripts/deploy`, `scripts/backup`, `scripts/release`, la release v1.3.0 y la auditoría técnica independiente de Codex) y en cuatro rondas de revisión con el operador.

Documentos que desarrollan este ADR:

- [Modelo de capacidades y compuertas](../orchestrator/capabilities-and-gates.md)
- [Registro de riesgos](../orchestrator/risk-register.md)
- [Plan de remediación OR-1 y OR-2](../orchestrator/remediation-or1-or2.md)
- [Incremento 0](../orchestrator/increment-0.md)
- [Plan de pruebas J1 del journal](../orchestrator/j1-journal-test-plan.md)

## Context

**Hechos verificados (2026-11-24):**

- La release v1.3.0 (commit `631e3a0`, 2026-11-23) se ejecutó con scripts PowerShell independientes (`Invoke-DaubertRelease.ps1`, `Deploy-DaubertHub.ps1`, `Set-EntryClosure.ps1`, `Switch-Manufactura.ps1`, `Test-ManufacturaReleaseReadiness.ps1`) coordinados a mano mediante un runbook. En B8 el contenedor Web no exponía `.State.Health` y la herramienta de esa versión no lo contemplaba; la recuperación (R0/R1/R2) y el expediente dependieron del operador ([release-v1.3.0](../deployments/release-v1.3.0.md)).
- Las herramientas no conservan un registro durable de intención antes de cada efecto. La evidencia JSON es *best effort* y un registro "COMPLETADO" no prueba el estado real.
- TEST y PROD comparten **un único host Windows, un único motor Docker Desktop (WSL2) y un único clúster PostgreSQL 18**. Quien accede al motor Docker accede a PROD.
- Los agentes de IA corren hoy como la misma cuenta (`06`) que ejecuta Docker Desktop.
- Docker Desktop arranca al iniciar sesión `06` y no hay inicio de sesión automático. Tras un reinicio del host, PROD no vuelve hasta que alguien inicia sesión.
- La identidad privada age de los respaldos es accesible en el host y es legible, por herencia, por el grupo `CodexSandboxUsers` (verificado solo con metadatos).
- Varios scripts contienen rutas de un usuario concreto. La auditoría de Codex encontró además un `Get-State` que informa `OPEN` ante fallos de transporte, un Switch `-Disable` sin confirmación y la promoción parcial de etiquetas en Deploy.
- **No habrá un laboratorio dedicado** a corto plazo. Este host tiene 16 GB de RAM con PROD en ejecución, lo que impide virtualizar un entorno Windows de pruebas sin poner PROD en riesgo.

**Necesidad:** un sistema independiente del Hub que prepare, planifique, autorice, ejecute, verifique, recupere y documente releases de forma reproducible, segura, auditable y recuperable, con separación estricta TEST/PROD y aprobación humana para operaciones críticas.

## Decision

### Modelo de control

- **DF-01 · Procedimiento explícito + journal write-ahead + verificación del estado real.** No hay convergencia automática ni reintento automático de efectos peligrosos. Cada efecto se precede de un *intent* durable y se sigue de una observación del estado real. La recuperación se hace observando y abriendo ejecuciones sucesoras, nunca repitiendo a ciegas.
- **DF-02 · Motor en TypeScript**, empaquetado en un solo archivo, con su propio `node.exe` portátil verificado por hash dentro de la instalación. Sin dependencias de runtime ni `npm install` en el host.
- **DF-03 · Las primitivas mutantes siguen en PowerShell** y se invocan como adaptadores con **contrato versionado**: cada script declara `contract: <nombre>/<versión>` y una tabla de códigos de salida legible por máquina. Un contrato desconocido se rechaza; no se interpreta.
- **DF-04 · Persistencia: journal JSONL append-only con cadena de hashes y un solo escritor.** Sin base de datos. **Condicionada a J1**: si J1 no supera P1–P12, se revisa esta decisión (alternativa prevista: proceso auxiliar .NET con `FileShare.None`). Garantías y límites en [§Garantías del journal](#garantías-y-límites-del-journal).

### Distribución y entorno

- **DF-05 · Código en este monorepo, instalaciones versionadas e independientes.** Línea de versión propia (`orchestrator-vX.Y.Z`), build reproducible con manifiesto de hashes. Los procedimientos viajan con el motor; los scripts del Hub se fijan por plan (SHA de commit y blob del clon operativo) y se validan por versión de contrato. El código vive en `orchestrator/`, **fuera** de los workspaces `apps/*`, para que no entre en el build ni en las imágenes del Hub.
- **DF-06 · Ubicaciones sin dependencia del usuario:** binarios en `%ProgramFiles%\DaubertHub\Orchestrator\<versión>\` (solo administradores) y estado en `%ProgramData%\DaubertHub\Orchestrator\` con **ACL explícita** (por defecto `ProgramData` permite crear archivos a cualquier usuario).
- **DF-07 · Perfiles de entorno obligatorios.** El motor no tiene rutas por defecto. El perfil declara endpoint de Docker, proyecto Compose, raíces operativas, checkout, base esperada y `environment` esperado. Sin perfil válido el motor no arranca; si el estado observado no coincide con el perfil, rechaza (`ENV_MISMATCH`).

### Autorización y privilegios

- **DF-08 · Proveedor de aprobaciones intercambiable.** Implementación inicial: un operador, consola interactiva, frase con nonce. Cada aprobación queda ligada a `planHash`, paso, `snapshotHash`, commit, entorno, usuario, nonce y caducidad. El modelo de datos admite `requiredApprovals: 1 | 2`; la doble aprobación se implementa después con firmas `ssh-keygen -Y sign/verify`.
- **DF-09 · Operaciones extraordinarias:** R2, migraciones en PROD, forzar la continuación tras `Uncertain`, ignorar una compuerta fallida, recuperar un journal corrupto y reubicar la raíz operativa. Exigirán doble aprobación cuando exista; mientras tanto quedan marcadas como extraordinarias con justificación obligatoria, y son clase C4 (solo modo guiado).
- **DF-10 · Separación de privilegios por cuenta del sistema operativo, no por política.** Los agentes de IA migran a una cuenta estándar `daubert-ai` sin acceso al motor Docker ni a archivos de PROD (migración M0–M4, sin interrumpir herramientas). Grupo `DaubertOps` solo para el operador. Las ejecuciones mutantes en PROD requieren consola interactiva elevada. Objetivo final: PROD en un servidor dedicado.
- **DF-11 · Sin mutación de PROD por el motor hasta superar las compuertas** G-C2 (efectos rutinarios) y G-C3 (mutaciones del runtime). El uso de solo lectura en PROD se permite desde el MVP en dos pasos: comprobaciones previas en V3 (AC1, compuerta G-C0a) habilitan la invocación manual supervisada en PROD, y la validación posterior en V4 (AC9, compuerta G-C0b) habilita el modo automático.

### Evidencias y host

- **DF-12 · Evidencias:** copia primaria local protegida; copia secundaria cifrada y publicada `.age` + `.sha256` reutilizando el pipeline de respaldos, con una **identidad de evidencias propia, solo offline y separada de la de respaldos**. El hash de cabecera del journal de cada ejecución cerrada se registra en la nota de despliegue en Git como ancla externa no sensible. Las evidencias nunca contienen secretos (verificado con canarios).
- **DF-13 · Laboratorio externo como capacidad futura, no como requisito.** Un laboratorio es un perfil más (`kind: lab`). Las evidencias que aporte (cortes de energía, fallos del motor Docker) entran en el mismo registro de compuertas y pueden **elevar** el modo máximo de una capacidad, sin rediseñar motor, journal ni procedimientos.
- **DF-14 · Invariantes de host compartido en cada snapshot:** anclas `rollback-*` de PROD presentes, PROD activo tras el arranque (detecta la dependencia del inicio de sesión) y recursos mínimos.
- **DF-15 · Habilitación por capacidad como dato versionado y aplicado técnicamente.** Cada capacidad tiene una clase (C0–C4), un modo máximo por entorno (Observar, Guiado, Supervisado, Automático) y la lista de evidencias que lo justifican. El motor **rechaza** ejecutar un paso por encima de su modo habilitado. Cambiar una habilitación exige un PR revisado y una instalación versionada nueva; no basta con editar configuración local. Detalle en el [modelo de capacidades](../orchestrator/capabilities-and-gates.md).

### Precisiones del operador (incorporadas en la aprobación del 2026-11-24)

- **P-A · Seguridad del host compartido.** La huella de PROD es un control de **detección**, no una garantía preventiva: detecta un daño después de ocurrido, no lo impide. Por eso todo paso mutante en V2 (sandbox Docker) o V3 (TEST) exige, **antes** de ejecutarse, restricciones de alcance comprobadas (etiqueta, prefijo, proyecto, lista negra, compuerta de recursos) y una **aprobación específica** de esa prueba. No se ejecutan pruebas que puedan afectar al motor Docker compartido ni a los servicios productivos: reiniciar o actualizar Docker Desktop, `wsl --shutdown`, saturar memoria o disco, cambiar redes o contextos de Docker, o detener servicios del host quedan fuera de V2/V3 y pasan a VX (laboratorio futuro).
- **P-B · Recuperación tras fallos de persistencia.** No se supone que toda pérdida de información del journal sea detectable. Ante evidencia insuficiente, el resultado es `Uncertain`, la ejecución se suspende (`Suspended`) y se exige reconciliación humana. Ninguna decisión automática se apoya en la ausencia de un registro.
- **P-C · OR-1.** Ninguna modificación de permisos, movimiento ni rotación de la identidad age ocurre sin demostrar antes, con un restore drill aislado, la capacidad de recuperar respaldos históricos de cada tier. Ver [plan OR-1](../orchestrator/remediation-or1-or2.md#or-1--custodia-de-la-identidad-age).

## Garantías y límites del journal

**Lo que el diseño garantiza** (sujeto a que J1 lo confirme en este host):

1. **Orden write-ahead.** Ningún efecto se ejecuta sin que su intent se haya escrito y sincronizado (`fs.fsyncSync` → `FlushFileBuffers`) y la llamada haya retornado sin error. Si la escritura o la sincronización fallan, el efecto **no** se ejecuta y la ejecución pasa a `Suspended`.
2. **Un solo escritor** por perfil, mediante un lock mantenido por el sistema operativo (se libera al morir el proceso, nunca se roba).
3. **Detección de corrupción interna.** La cadena de hashes (`prevHash` + `seq`) detecta cualquier modificación, borrado, reordenación o duplicado de registros **anteriores al último registro válido**.
4. **Cola rota acotada (regla conservadora).** Solo se repara automáticamente una cola que, tras el último registro válido, consiste exactamente en un fragmento final sin `\n` de cierre, en una región final formada solo por bytes NUL, o en un fragmento seguido de esa región. Esa cola se conserva byte a byte, se trunca al último prefijo válido y se registra `TornTailRecovered`. Cualquier otro patrón, incluida una línea **completa** con JSON, hash, `seq` o `prevHash` inválidos aunque sea la última, o una línea duplicada, se clasifica `Corrupt` y no se repara. No se afirma que una caída solo pueda producir los patrones reparables: un patrón distinto da un falso `Corrupt` con revisión humana, nunca una reparación indebida ([plan J1 §3.4](../orchestrator/j1-journal-test-plan.md#34-recuperación-al-abrir)).
5. **Lectores sin falsos registros.** Solo exponen registros completos con hash válido y nunca reparan.

**Lo que el diseño NO garantiza:**

1. **Que el disco respete el flush.** `FlushFileBuffers` pide al sistema y al dispositivo vaciar cachés; si el disco miente sobre su caché o no tiene protección ante pérdida de energía, un registro sincronizado puede perderse en un corte. No hay laboratorio para medirlo (J1-P13d diferido).
2. **Detectar la pérdida de los últimos registros.** Una cadena de hashes no puede detectar el **truncamiento limpio** de su propio final: un journal al que le faltan los N últimos registros es un prefijo válido indistinguible de uno que nunca los tuvo. Tampoco detecta la sustitución completa del archivo por un tercero con acceso de escritura (la integridad frente a un atacante depende de la ACL de DF-06 y del ancla externa de DF-12, no de la cadena).
3. **Durabilidad de metadatos de directorio.** Windows no permite `fsync` de directorio; por eso el archivo del journal se crea y sincroniza antes de cualquier efecto y no se renombra nunca.

**Cómo se compensan los límites (P-B):**

- La reconciliación **no confía en el journal como fuente del estado del mundo**: tras cualquier interrupción observa el estado real y lo compara con el último intent conocido.
- Si el estado observado es explicable por el journal, se clasifica (`Verified`, `NotApplied`, `AppliedUnverified`, `Partial`).
- Si el estado observado muestra un efecto que el journal no registra, o la evidencia no permite decidir si un efecto ocurrió, el paso queda en **`Uncertain`** (o `Diverged` si contradice lo esperado), la ejecución pasa a `Suspended` y solo un humano puede reconciliar. Continuar exige una operación extraordinaria (DF-09, C4).
- Cada efecto mutante deja además rastros **fuera del journal** (anclas `rollback-*`, metadatos de lock, logs de los scripts, eventos de Docker) que la reconciliación contrasta con el journal; su ausencia nunca se interpreta como "no ocurrió".

## Consequences

**Positivas**

- La próxima release de PROD puede ejecutarse en **modo guiado** sin que el motor tenga capacidad de mutar: el operador conserva cada efecto y el orquestador aporta secuencia, compuertas, verificación, recuperación y expediente.
- Las habilitaciones son explícitas, revisables y técnicamente aplicadas; ninguna aceptación de riesgo es "general" (NB-7).
- La arquitectura no cambia al aparecer un laboratorio o un servidor dedicado: ambos son perfiles.

**Costos**

- Con DF-10, los agentes de IA pierden el acceso directo a Docker en este host. Sin laboratorio, las operaciones con Docker en TEST las ejecuta el operador o el motor bajo su aprobación.
- C3 (Deploy, Switch, cierre) permanece en modo guiado en PROD hasta G-C3, y C4 permanece siempre en modo guiado mientras no haya laboratorio o un ADR específico con doble aprobación.
- Más disciplina documental: registro de riesgos y de compuertas versionados en Git.

**Riesgos residuales propuestos, pendientes de aceptación individual** (NB-7; detalle, compensaciones y estado en el [registro de riesgos](../orchestrator/risk-register.md)). Este ADR no acepta ninguno: cada uno se acepta por separado, y una capacidad no sube de modo mientras alguno de sus riesgos siga pendiente: RA-1 durabilidad ante corte de energía no demostrada; RA-2 fallos del motor Docker no probados; RA-3 diferencias TEST/PROD; RA-4 consumo de recursos de las pruebas; RA-5 lock colgado; RA-6 comando no verificado en modo guiado.

## Alternatives Considered

Evaluadas en las revisiones de diseño del 2026-11-24 (no hay commits previos):

- **Convergencia declarativa estilo GitOps.** Rechazada: aplica efectos repetidamente hasta converger, incompatible con "no reintentar efectos peligrosos".
- **Reescribir las primitivas en TypeScript.** Rechazada por ahora: descarta código probado con Pester (DF-03).
- **Persistencia en PostgreSQL o SQLite.** Rechazada: PostgreSQL comparte host y clúster con PROD y puede ser el objeto de la recuperación; SQLite añade una dependencia nativa. Si J1 falla, la alternativa es un auxiliar .NET, no una base de datos.
- **Repositorio separado.** Rechazado: aumentaría el riesgo de desfase de contratos con los scripts del Hub (DF-05).
- **Separación solo por política o por UAC.** Rechazada como frontera: con un solo motor Docker, una regla escrita no impide el acceso a PROD; UAC no es una frontera de seguridad (se conserva como señal de presencia humana).
- **Laboratorio en VM sobre este host o distro WSL propia.** Rechazado: la VM no cabe en 16 GB con PROD activo; la distro WSL comparte VM y kernel con Docker Desktop.
- **Inicio de sesión automático para resolver OR-2.** Rechazado: deja una cuenta administradora con sesión abierta sin presencia humana.

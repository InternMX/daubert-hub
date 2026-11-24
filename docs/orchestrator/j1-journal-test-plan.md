# Plan de pruebas J1 · Journal en Windows con Node

- **Status:** Propuesto. No implementado.
- **Fecha:** 2026-11-24
- Decide si DF-04 de [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md) pasa de *condicionada* a *aceptada*. Las garantías y límites que este plan debe confirmar están en [ADR-006 § Garantías y límites del journal](../decisions/ADR-006-update-orchestrator-arquitectura.md#garantías-y-límites-del-journal).

## 1. Objetivo

Demostrar, en este host y con el Node que se empaquetará, que el protocolo de journal:

1. garantiza un solo escritor;
2. nunca ejecuta un efecto sin su intent sincronizado;
3. distingue cola rota de corrupción interna sin falsos positivos;
4. no expone a los lectores registros que luego desaparecen;
5. **declara correctamente lo que no puede saber** (precisión P-B).

## 2. Condiciones

- Nivel V0/V1. Carpeta temporal `%TEMP%\daubert-orch-j1-<runid>\` creada por la propia suite. Si todas las pruebas pasan, se borra al terminar; **si alguna falla, se conserva** con sus journals, colas `journal.torn-*`, logs de procesos y semillas, y se borra solo tras la revisión. **Sin** Hub, Docker, PROD, TEST, bases reales, red, `%ProgramData%` ni rutas operativas.
- J1 es una prueba técnica del protocolo, **no** el inicio del motor: no se añaden perfiles, adaptadores, CLI ni empaquetado.
- Node **v24.21.0** (libuv **1.52.1**), el mismo que se empaquetará. La suite registra `process.version` y `process.versions.uv` en el informe y falla si no coinciden con los fijados.
- Usuario estándar sin elevar. Sin dependencias npm: solo módulos integrados de Node (`node:fs`, `node:child_process`, `node:net`, `node:crypto`, `node:test`) y TypeScript de sintaxis borrable ejecutado con el soporte nativo de Node 24.
- PowerShell 5.1 solo para el holder de interoperabilidad (P4).
- Consumo acotado: como máximo 8 procesos simultáneos; ninguna prueba de saturación de disco o memoria.

## 3. Diseño bajo prueba

### 3.1 Formato del registro

Una línea JSON por registro, terminada en `\n`, UTF-8 sin BOM:

```text
{"v":1,"seq":<n>,"prevHash":"<hex>","ts":"<ISO-8601 UTC>","type":"<tipo>","body":{...},"hash":"<hex>"}
```

- `hash` = SHA-256 de la serialización canónica del registro **sin** el campo `hash`.
- Serialización canónica: claves ordenadas, sin espacios, sin números de coma flotante (enteros o cadenas), cadenas normalizadas NFC.
- `seq` 0 es la cabecera (`type: "JournalOpened"`, `runId`, `profile`, versión del motor, `prevHash` = 64 ceros).
- Tipos mínimos del PoC: `JournalOpened`, `Intent`, `Outcome`, `TornTailRecovered`, `Note`.

### 3.2 Exclusión de escritores

| Candidato | Mecanismo | Nota |
|---|---|---|
| **A** | Archivo de lock abierto con el flag crudo `0x10000000` (`UV_FS_O_EXLOCK` de libuv → modo de compartición 0). | No está en `fs.constants` de Node 24.21: comportamiento no documentado de libuv, mitigado por el Node fijado y por re-ejecutar P1 en cada actualización de Node. |
| **B** | Named pipe `\\.\pipe\daubert-orch-j1-<runid>` con `net.Server.listen` (libuv usa `FILE_FLAG_FIRST_PIPE_INSTANCE`). | Otro usuario podría ocupar el nombre: denegación de servicio, nunca evasión. |

El lock lo libera el sistema al morir el proceso. Los metadatos del holder (PID, inicio, propósito) van en un archivo aparte, solo informativos. El lock **nunca se roba**.

### 3.3 Escritura y sincronización

- Un solo `fs.writeSync(fd, buf, 0, len, offset)` por registro con offset explícito (sin `O_APPEND`), en bucle hasta escribir todos los bytes.
- `fs.fsyncSync(fd)` tras cada `Intent` y cada `Outcome`. Un registro se considera **confirmado** solo cuando `fsyncSync` retorna sin error.
- **Si `writeSync` o `fsyncSync` lanzan**, el journal pasa a *sospechoso*: no se reintenta el fsync sobre el mismo descriptor ni se asume éxito, no se ejecuta el efecto, la ejecución pasa a `Suspended` y reabrir exige un escaneo completo.
- El archivo del journal se crea y sincroniza antes del primer efecto y **no se renombra nunca** (Windows no ofrece fsync de directorio).

### 3.4 Recuperación al abrir

1. Escaneo secuencial verificando `seq`, `prevHash` y `hash`.
2. **Cola rota:** si los únicos bytes inválidos están **al final** (línea incompleta, NUL, JSON inválido o hash inválido en la última línea, sin registros válidos después), se copia la cola a `journal.torn-<utc>` (con fsync), se trunca al último prefijo válido (`ftruncateSync` + fsync) y se anexa `TornTailRecovered` con el número de bytes y el hash de la cola.
3. **Corrupción interna:** si hay registros válidos después de uno inválido, el journal queda `Corrupt`: solo lectura, sin reparación, con el índice del primer registro inválido.
4. El resultado de la apertura siempre declara `lastConfirmedSeq` y un indicador `tailEvidence: "clean" | "torn" | "corrupt"`. **Un prefijo limpio no se presenta como prueba de que no se perdió nada** (ver P14).

### 3.5 Lectores

Abren en solo lectura, exponen únicamente registros completos con hash válido y encadenado, y nunca reparan.

## 4. Pruebas y criterios de aceptación

| # | Nivel | Prueba | Criterio de aceptación |
|---|---|---|---|
| **P1** | V1 | 2, 4 y 8 procesos compiten por el lock durante 10 000 adquisiciones en total, con un contador compartido que detecta solapes | **0** solapes, para A y para B |
| **P2** | V1 | Holder terminado con `taskkill /F` en un momento aleatorio | Siguiente adquisición en ≤ 2 s en 100/100 intentos |
| **P3** | V1 | Holder colgado (bucle de espera) | 100 % `LOCK_HELD` con los metadatos del holder; nunca se roba |
| **P4** | V1 | Interoperabilidad con un holder PowerShell que abre `operacion.lock` como `Enter-DaubertOperationLock` (`FileShare.Read`), en ambos sentidos | 100 % de exclusión mutua en 100 intentos por sentido |
| **P5** | V1 | Escritor que confirma cada registro tras fsync, terminado con `taskkill /F` en ≥ 1 000 momentos aleatorios (incluso a mitad de escritura) | **0** registros confirmados perdidos; prefijo siempre válido; **0** falsos `Corrupt` |
| **P6** | V0 | Colas sintéticas: truncado en cada byte del último registro, relleno NUL (512 B y 4 KiB), basura, línea final duplicada | 100 % `torn`; reparado al prefijo exacto; cola conservada byte a byte en `journal.torn-*` |
| **P7** | V0 | Corrupción interna: bit alterado, línea borrada, orden cambiado, `seq` duplicado (≥ 1 000 casos generados) | 100 % `Corrupt` con el índice correcto; sin reparación; archivo intacto |
| **P8** | V1 | 4 lectores concurrentes mientras el escritor es terminado repetidamente | **0** registros mostrados por un lector que luego desaparecen |
| **P9** | V1 | 10 000 ciclos de lock y 100 000 escrituras con Defender activo, en la carpeta temporal | 0 errores de datos; tasa de ocupación espuria del lock medida y documentada |
| **P10** | V1 | Latencia de `writeSync` + `fsyncSync` por registro (10 000 muestras) | p99 < 50 ms en el SSD del host; p50 y p99 documentados |
| **P11** | V0 | Serialización canónica con pruebas de propiedades (generador propio con semilla registrada) | Ida y vuelta estable; mismo hash para objetos equivalentes; distinto ante cualquier cambio de campo |
| **P12** | V0 | `ENOSPC` y `EIO` inyectados en `write` y en `fsync` mediante la capa de E/S | El intent no se confirma; el efecto simulado se ejecuta **0** veces; la ejecución pasa a `Suspended`; no se reintenta el fsync |
| **P13a** | V0 | Enumeración de estados de caída (estilo ALICE/CrashMonkey): la capa de E/S registra cada `write`/`fsync`; un generador produce todos los estados de disco compatibles con un dispositivo que solo garantiza lo sincronizado (escrituras no sincronizadas perdidas, parciales por sector de 512 B/4 KiB, reordenadas, rellenas de ceros) | Para cada estado: la recuperación da un prefijo válido que contiene **todos** los registros confirmados, o `torn`/`Corrupt`; **nunca** un registro fantasma; **nunca** `lastConfirmedSeq` mayor que lo realmente sincronizado |
| **P13b** | Doc | Correspondencia de la llamada: en el código fuente público de libuv 1.52.1, `uv_fs_fsync` en Windows llega a `FlushFileBuffers` | Referencia a archivo y función de libuv en el informe. Opcional: traza de Process Monitor, solo si el operador acepta ejecutarla elevado |
| **P13c** | Doc | Inventario de solo lectura del disco: modelo, tipo de bus, política de caché de escritura y protección ante pérdida de energía declarada | Datos documentados en el registro de riesgos (RA-1) |
| **P13d** | VX | Cortes de energía reales con confirmaciones registradas fuera de la máquina | **Diferida** hasta que exista laboratorio. No bloquea J1 |
| **P14** | V0 | **Límite declarado (P-B).** Se eliminan limpiamente los N últimos registros confirmados (N = 1…5) | La apertura devuelve un prefijo válido con `tailEvidence: "clean"` y `lastConfirmedSeq` menor. La prueba **documenta** que el journal no puede detectar esta pérdida por sí solo; la detección corresponde a la reconciliación contra el estado observado (incremento 2) |

## 5. Resultado esperado

Un informe `docs/orchestrator/j1-report.md` con:

1. versiones de Node y libuv, características del disco (P13c) y semillas de las pruebas aleatorias;
2. resultados medidos de P1–P12, P13a y P14;
3. **decisión de exclusión** (A o B) con justificación;
4. referencias de P13b;
5. garantías confirmadas y límites, para actualizar RA-1;
6. recomendación sobre DF-04: *aceptada*, o *revisar* (si fallan P1–P5, alternativa: proceso auxiliar .NET con `FileShare.None`).

## 6. Fuera de alcance

Motor, adaptadores, aprobaciones, reconciliación contra el estado observado, empaquetado con `node.exe` propio y cualquier ruta en `%ProgramData%`. El código del PoC se escribe para poder reutilizarse como módulo del motor si J1 se supera, pero no es todavía código de producción.

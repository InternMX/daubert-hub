# Plan de pruebas J1 · Journal en Windows con Node

- **Status:** Propuesto, revisión 1.1. No implementado.
- **Fecha:** 2026-11-24 (1.0); 2026-11-24 (1.1: ajustes A1–A8 aprobados por el operador).
- Decide si DF-04 de [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md) pasa de *condicionada* a *aceptada*. Las garantías y límites que este plan debe confirmar están en [ADR-006 § Garantías y límites del journal](../decisions/ADR-006-update-orchestrator-arquitectura.md#garantías-y-límites-del-journal).
- **Nota de coherencia:** la regla de cola reparable de §3.4 es **más restrictiva** que el punto 4 de las garantías de ADR-006 ("JSON o hash inválido al final"). Prevalece este plan; el texto del ADR se alineará en un cambio aparte.

## 1. Objetivo

Demostrar, en este host y con el Node que se empaquetará, que el protocolo de journal:

1. garantiza un solo escritor y conserva la exclusión mutua con los locks PowerShell existentes;
2. nunca ejecuta un efecto sin su intent sincronizado;
3. distingue cola rota de corrupción interna sin falsos positivos y **sin reparar lo que no es explicable**;
4. no expone a los lectores registros que luego desaparecen tras la terminación de un proceso;
5. **declara correctamente lo que no puede saber** (precisión P-B).

## 2. Condiciones

- Nivel V0/V1. Carpeta temporal `%TEMP%\daubert-orch-j1-<runid>\` creada por la propia suite. Si todas las pruebas pasan, se borra al terminar; **si alguna falla, se conserva** con sus journals, colas `journal.torn-*`, logs de procesos y semillas, y su ruta se imprime al final; se borra solo tras la revisión. **Sin** Hub, Docker, PROD, TEST, bases reales, red, `%ProgramData%` ni rutas operativas.
- J1 es una prueba técnica del protocolo, **no** el inicio del motor: no se añaden perfiles, adaptadores, CLI, empaquetado ni abstracciones que las pruebas no necesiten.
- Node **v24.21.0** (libuv **1.52.1**), el mismo que se empaquetará. La suite registra `process.version` y `process.versions.uv` y falla si no coinciden con los fijados.
- Usuario estándar sin elevar. Sin dependencias npm: solo módulos integrados de Node y TypeScript de sintaxis borrable ejecutado con el soporte nativo de Node 24.
- PowerShell 5.1 solo para el holder de interoperabilidad (P0 y P4). Para máxima fidelidad se usa la función real `Enter-DaubertOperationLock` importando `scripts/deploy/DaubertOps.Common.psm1` **sin modificarlo**, siempre con una ruta de lock dentro de la carpeta temporal (nunca la raíz operativa). Si la importación tuviera efectos fuera de la carpeta temporal, se usa una copia literal de las dos funciones de lock con el SHA-256 del módulo de origen registrado en el informe.

### 2.1 Separación de evidencias

| Evidencia | Quién y dónde | Valor |
|---|---|---|
| **V0** (P6, P7, P11, P12, P13a, P14) | Codex dentro de su sandbox, y Claude al revisar | Lógica del protocolo; independiente de la cuenta y del entorno |
| **V1** (P0–P5, P8–P10) | **Claude como el usuario operativo, fuera del sandbox**, después de la revisión del código | **Evidencia oficial.** Las ejecuciones V1 dentro del sandbox de Codex (otras cuentas, ACL, `%TEMP%` y restricciones de procesos) solo sirven para depurar y no se citan en el informe |

El informe identifica para cada resultado quién lo ejecutó, con qué cuenta y en qué fecha.

### 2.2 Recursos del host compartido

El host ejecuta PROD. Antes de cualquier ejecución V1 completa:

1. Se ejecuta una **pasada reducida** (≈ 5 % de las iteraciones de P1, P5, P9 y P10) y se miden duración, CPU, número máximo de procesos y bytes escritos.
2. Se extrapola el consumo de la pasada completa y se presenta al operador.
3. La pasada completa se ejecuta **solo con su aprobación**, preferiblemente fuera del horario de uso del Hub.

Límites fijos de la suite: como máximo 8 procesos hijos simultáneos; ningún archivo de prueba mayor de 64 MiB; ninguna prueba de saturación de disco, memoria o CPU; presupuesto total de la pasada completa ≤ 30 min.

## 3. Diseño bajo prueba

### 3.1 Formato del registro

Una línea JSON por registro, terminada en `\n`, UTF-8 sin BOM:

```text
{"v":1,"seq":<n>,"prevHash":"<hex>","ts":"<ISO-8601 UTC>","type":"<tipo>","body":{...},"hash":"<hex>"}
```

- `hash` = SHA-256 de la serialización canónica del registro **sin** el campo `hash`.
- Serialización canónica: claves ordenadas, sin espacios, UTF-8 **exacto, sin normalización Unicode** (normalizar alteraría rutas y textos del operador).
- Valores rechazados por el serializador (error, no conversión): números no enteros, enteros fuera de `Number.MIN_SAFE_INTEGER…MAX_SAFE_INTEGER`, `-0`, `NaN`/`Infinity`, cadenas con sustitutos UTF-16 sueltos, `undefined`, funciones y objetos no planos.
- `seq` 0 es la cabecera (`type: "JournalOpened"`, `runId`, `profile`, versión del motor, `prevHash` = 64 ceros).
- Tipos mínimos del PoC: `JournalOpened`, `Intent`, `Outcome`, `TornTailRecovered`, `Note`.
- `ts` es informativo; el orden lo dan `seq` y `prevHash`.

### 3.2 Exclusión

Hay **dos locks distintos**:

- el **lock de escritor único** del journal, por perfil;
- el **lock operativo** `operacion.lock`, compartido con los scripts PowerShell (`Enter-DaubertOperationLock` abre con `FileMode.OpenOrCreate`, `FileAccess.ReadWrite` y `FileShare.Read`, reintenta cada 250 ms y termina con `DAUBERT_LOCK_OCUPADO`).

El orden de adquisición entre ambos es una decisión del motor, fuera de J1.

**Mecanismo candidato A (para ambos locks):** abrir el archivo de lock con lectura/escritura, creación sin truncado y el flag crudo `0x10000000` (`UV_FS_O_EXLOCK` de libuv → modo de compartición 0). No está en `fs.constants` de Node 24.21: es comportamiento no documentado, mitigado por el Node fijado y por re-ejecutar P0 y P1 en cada actualización de Node.

- El sistema libera el lock al morir el proceso. El lock **nunca se roba** y el archivo de lock **nunca se borra**.
- Los metadatos del holder (PID, inicio, propósito) van en un archivo aparte, solo informativos.
- **Ocupación espuria** (p. ej. Defender abriendo el archivo un instante): espera acotada de **2 s con intentos cada 50 ms**; después, `LOCK_HELD`.
- **Limitación conocida:** Node solo puede abrir con compartición total o con compartición 0. Mientras Node tenga `operacion.lock`, `Get-DaubertOperationLockInfo` no puede leerlo y el mensaje `DAUBERT_LOCK_OCUPADO` de PowerShell sale **sin datos del holder**. La exclusión se conserva; el diagnóstico se degrada. Mejorarlo (metadatos en un archivo hermano que PowerShell lea) es un PR posterior del bloque 0a.

**P0 es bloqueante.** Si el candidato A falla, **no** se adopta automáticamente otro mecanismo:

1. Un named pipe (antiguo candidato B) **no** interopera con `operacion.lock`, porque es un espacio de nombres distinto: no basta para el lock operativo.
2. Cualquier alternativa (p. ej. un proceso auxiliar .NET que mantenga el archivo con `FileShare.None`, o una adaptación del lado PowerShell) debe **demostrar primero** la exclusión mutua en ambos sentidos con `Enter-DaubertOperationLock` sin modificar su comportamiento.
3. Si no existe una solución verificada, J1 se **detiene** y se presentan alternativas al operador antes de seguir. DF-04 queda en revisión.

### 3.3 Escritura y sincronización

- Un solo `fs.writeSync(fd, buf, 0, len, offset)` por registro con offset explícito (sin `O_APPEND`), en bucle hasta escribir todos los bytes.
- `fs.fsyncSync(fd)` tras cada `Intent` y cada `Outcome`. Un registro se considera **confirmado** solo cuando `fsyncSync` retorna sin error.
- **Si `writeSync` o `fsyncSync` lanzan**, el journal pasa a *sospechoso*: no se reintenta el fsync sobre el mismo descriptor ni se asume éxito, no se ejecuta el efecto, la ejecución pasa a `Suspended` y reabrir exige un escaneo completo.
- El archivo del journal se crea y sincroniza antes del primer efecto y **no se renombra nunca** (Windows no ofrece fsync de directorio).
- Node no permite abrir el journal con compartición "solo lectura": la protección frente a otros escritores es el lock de escritor (cooperativo) más la ACL de la ubicación (DF-06).

### 3.4 Recuperación al abrir

1. Escaneo secuencial verificando `seq`, `prevHash` y `hash`.
2. **Cola reparable (regla conservadora).** Solo se repara automáticamente cuando, a partir del último registro válido, los bytes restantes encajan **exactamente** en uno de estos patrones:
   - (a) un fragmento final **sin** `\n` de cierre;
   - (b) una región final formada **solo** por bytes NUL;
   - (c) un fragmento sin `\n` seguido de una región solo de NUL.

   En ese caso se copia la cola a `journal.torn-<utc>` (con fsync), se trunca al último prefijo válido (`ftruncateSync` + fsync) y se anexa `TornTailRecovered` con el número de bytes y el hash de la cola.
3. **Todo lo demás es `Corrupt`** (solo lectura, sin reparación, con el índice del primer registro inválido), en particular:
   - una línea **completa** (terminada en `\n`) con JSON inválido, hash inválido, `seq` o `prevHash` incorrectos, aunque sea la última;
   - una línea final duplicada;
   - bytes no NUL después de una región NUL;
   - registros válidos después de uno inválido.
4. El resultado de la apertura siempre declara `lastConfirmedSeq` y `tailEvidence: "clean" | "torn" | "corrupt"`. **Un prefijo limpio no se presenta como prueba de que no se perdió nada** (ver P14).

**Límite de lo que se puede demostrar.** No afirmamos que una caída del sistema solo pueda producir los patrones (a)–(c). Los efectos físicos de una caída dependen del sistema de archivos, del controlador y del dispositivo, y J1 no puede observarlos directamente (P13d diferida). Lo que J1 demuestra es:

- que esos patrones son los que produce el **modelo** de P13a (escrituras no sincronizadas perdidas, parciales por sector o rellenas de ceros) y la terminación de procesos (P5);
- que cualquier otro patrón se clasifica `Corrupt`.

Consecuencia: si una caída real produjera un patrón distinto, el resultado es un **falso `Corrupt`** (revisión humana; P-B), nunca una reparación automática indebida. La regla también acepta, sin poder distinguirla, una manipulación que imite los patrones (a)–(c); en ese caso la cola queda conservada en `journal.torn-*`, y la integridad frente a terceros depende de la ACL (DF-06) y del ancla externa (DF-12), no de esta regla.

### 3.5 Lectores

Abren en solo lectura, exponen únicamente registros completos con hash válido y encadenado, y nunca reparan.

## 4. Pruebas y criterios de aceptación

| # | Nivel | Prueba | Criterio de aceptación |
|---|---|---|---|
| **P0** | V1 | **Puerta de entrada (bloqueante, primera prueba).** Con el candidato A: (1) un segundo proceso Node no puede abrir el archivo de lock ni con lectura ni con escritura; (2) `Enter-DaubertOperationLock` (`TimeoutSeconds = 0`, ruta de lock dentro de la carpeta temporal) recibe `DAUBERT_LOCK_OCUPADO`; (3) con el lock en manos de PowerShell, el candidato A no puede abrirlo; (4) tras terminar el holder, el lock se adquiere | Los cuatro puntos se cumplen. Si alguno falla, J1 se detiene según §3.2 |
| **P1** | V1 | 2, 4 y 8 procesos compiten por el lock A durante 10 000 adquisiciones en total. Detección de solapes: dentro de la sección crítica cada holder crea un **archivo centinela en modo exclusivo** (`wx`) y lo borra al salir | **0** errores `EEXIST` sobre el centinela (cero solapes) |
| **P2** | V1 | Holder terminado con `taskkill /F` en un momento aleatorio | Siguiente adquisición en ≤ 2 s en 100/100 intentos |
| **P3** | V1 | Holder colgado (bucle de espera) | 100 % `LOCK_HELD` tras la espera acotada, con los metadatos del holder; nunca se roba |
| **P4** | V1 | Interoperabilidad con `operacion.lock`: holder PowerShell (`Enter-DaubertOperationLock`) frente al candidato A, en ambos sentidos | 100 % de exclusión mutua en 100 intentos por sentido; con el lock en manos de A, PowerShell termina **siempre** con `DAUBERT_LOCK_OCUPADO` (no con otra excepción); la ausencia de datos del holder se documenta |
| **P5** | V1 | Escritor hijo que, tras cada fsync, informa al proceso padre del `seq` confirmado (por stdout o IPC); el padre lo registra y termina al hijo con `taskkill /F` en ≥ 1 000 momentos aleatorios, incluso a mitad de escritura | **0** registros confirmados (según el registro del padre) ausentes tras reabrir; prefijo siempre válido; **0** `Corrupt` |
| **P6** | V0 | Colas sintéticas reparables: truncado en cada byte del último registro (fragmento sin `\n`); relleno NUL de 512 B y 4 KiB; fragmento seguido de NUL | 100 % `torn`; reparado al prefijo exacto; cola conservada byte a byte en `journal.torn-*` |
| **P7** | V0 | Corrupción y patrones no reparables (≥ 1 000 casos generados): bit alterado, línea borrada, orden cambiado, `seq` duplicado, **línea final completa con hash inválido**, **línea final duplicada**, línea final completa de basura, bytes no NUL tras una región NUL | 100 % `Corrupt` con el índice correcto; sin reparación; archivo intacto byte a byte |
| **P8** | V1 | 4 lectores concurrentes mientras el escritor es terminado repetidamente | **0** registros mostrados por un lector que luego desaparecen, **ante terminación de procesos**. Ante cortes de energía no se afirma nada (RA-1) |
| **P9** | V1 | 10 000 ciclos de lock y **20 000** escrituras con fsync con Defender activo, en la carpeta temporal | 0 errores de datos; tasa de ocupación espuria del lock medida; duración dentro del presupuesto de §2.2 |
| **P10** | V1 | Latencia de `writeSync` + `fsyncSync` por registro (10 000 muestras) | **Medición informativa:** p50, p99 y máximo documentados; tope de seguridad p99 < 200 ms (una release escribe decenas de registros) |
| **P11** | V0 | Serialización canónica con pruebas de propiedades (generador propio con semilla registrada) | Ida y vuelta estable; mismo hash para objetos equivalentes; distinto ante cualquier cambio de campo; los valores de §3.1 se rechazan con error |
| **P12** | V0 | `ENOSPC` y `EIO` inyectados en `write` y en `fsync` mediante la capa de E/S, también con escritura parcial antes del error | El intent no se confirma; el efecto simulado se ejecuta **0** veces; la ejecución pasa a `Suspended`; no se reintenta el fsync; al reabrir, la cola parcial se clasifica según §3.4 |
| **P13a** | V0 | Enumeración de estados de caída (estilo ALICE/CrashMonkey) sobre el registro de operaciones de la capa de E/S. Espacio de estados acotado: como hay fsync tras cada registro, la ventana no sincronizada es como máximo la última escritura. Por cada punto de corte: archivo ausente o vacío (si su creación no estaba sincronizada), y la última escritura persistida en 0…k sectores de 512 B y de 4 KiB, con el resto ausente o relleno de ceros | Para cada estado: la recuperación da un prefijo válido que contiene **todos** los registros confirmados, o `torn`/`Corrupt`; **nunca** un registro fantasma; **nunca** `lastConfirmedSeq` mayor que lo realmente sincronizado. El número total de estados es determinista y se informa |
| **P13b** | Doc | Correspondencia de la llamada: en el código fuente público de libuv 1.52.1, `uv_fs_fsync` en Windows llega a `FlushFileBuffers` | Referencia a archivo y función de libuv en el informe. Opcional: traza de Process Monitor, solo si el operador acepta ejecutarla elevado |
| **P13c** | Doc | Inventario de solo lectura del disco: modelo, tipo de bus, política de caché de escritura, **si está activada la política "desactivar el vaciado del búfer de caché de escritura de Windows"** (si lo está, `FlushFileBuffers` no vacía la caché del dispositivo) y protección ante pérdida de energía declarada | Datos documentados en el registro de riesgos (RA-1) |
| **P13d** | VX | Cortes de energía reales con confirmaciones registradas fuera de la máquina | **Diferida** hasta que exista laboratorio. No bloquea J1 |
| **P14** | V0 | **Límite declarado (P-B).** Se eliminan limpiamente los N últimos registros confirmados (N = 1…5) | La apertura devuelve un prefijo válido con `tailEvidence: "clean"` y `lastConfirmedSeq` menor. La prueba **documenta** que el journal no puede detectar esta pérdida por sí solo; la detección corresponde a la reconciliación contra el estado observado (incremento 2) |

## 5. Resultado esperado

Un informe `docs/orchestrator/j1-report.md`, en un PR documental separado del código, con:

1. versiones de Node y libuv, características del disco (P13c) y semillas de las pruebas aleatorias;
2. resultados medidos de P0–P12, P13a y P14, **separados en V0 y V1** e identificando quién ejecutó cada uno, con qué cuenta y cuándo (§2.1);
3. resultado de P0 y **decisión de exclusión**: candidato A confirmado o, si falló, las alternativas evaluadas según §3.2;
4. referencias de P13b;
5. garantías confirmadas y límites (incluido el de §3.4), para actualizar RA-1;
6. recomendación sobre DF-04: *aceptada*, o *revisar*.

## 6. Fuera de alcance

Motor, adaptadores, aprobaciones, reconciliación contra el estado observado, orden de adquisición entre locks, empaquetado con `node.exe` propio y cualquier ruta en `%ProgramData%`. El código del PoC se escribe para poder reutilizarse como módulo del motor si J1 se supera, pero no es todavía código de producción.

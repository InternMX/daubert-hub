# Planes de remediación OR-1 y OR-2

- **Status:** Propuesto. **Ningún paso de este documento se ha ejecutado.** Los ejecuta el operador, fase por fase, con su aprobación explícita. Los agentes de IA solo preparan y verifican en lectura.
- **Fecha:** 2026-11-24
- Riesgos en el [registro](risk-register.md#3-riesgos-operativos-actuales-or). Procedimiento de restauración de referencia: [postgresql-backup-automation § Recuperación y restore](../operations/postgresql-backup-automation.md#recuperación-y-restore).

Reglas comunes:

- Ningún comando imprime, copia a logs ni muestra el contenido de la identidad age, frases de paso, `pgpass` ni `pilot.prod.env`.
- Toda salida en texto plano de un descifrado se escribe en una carpeta temporal **local, fuera de Dropbox**, y se borra al terminar la fase.
- Cada fase termina con una nota de evidencia (qué se hizo, archivos probados por nombre y SHA-256, resultado) sin secretos.
- Si una fase falla, **no se pasa a la siguiente**. Se documenta y se decide.

---

## OR-1 · Custodia de la identidad age

**Objetivo:** que la identidad privada de los respaldos no sea legible por cuentas de agentes o sandbox ni dependa de Dropbox, **sin perder en ningún momento la capacidad de recuperar respaldos históricos** (precisión P-C).

**Hechos [F]:** identidad en `...\RECOVERY\DAUBERT HUB\KEYS\daubert-backup-age-identity.age` (374 bytes, mtime 2026-09-29) con hermanos `.sha256` y `-recipient.txt`; ACL: SYSTEM, Administradores y `06` control total, `CodexSandboxUsers` ReadAndExecute heredado. Retención de respaldos: Frequent 7 d, Daily 30 d, Monthly 12 meses. El restore drill con la clave en una estación separada sigue pendiente según la documentación de respaldos.

### Fase 0 · Inventario (solo lectura)

1. El operador confirma si la identidad está protegida con frase de paso: la **primera línea** del archivo es `age-encryption.org/v1` y existe una estrofa `-> scrypt`. Solo se anota "sí/no"; no se muestra nada más.
2. Verificar el `.sha256` hermano contra el archivo.
3. Listar, por tier, el respaldo más antiguo y el más reciente dentro de la retención (nombre, tamaño, SHA-256 del sidecar).
4. Confirmar si existe hoy alguna **otra copia** de la identidad fuera de Dropbox.
5. Identificar la **estación independiente** para el drill (distinta del host productor, como exige la documentación de respaldos).

**Decisiones del operador (2026-11-24):**

- **Custodia:** la custodia inicial es responsabilidad operativa del operador, con un **custodio alterno** que se designará formalmente. Las copias de recuperación se mantienen **offline y en ubicaciones separadas**.
- **Lugar del drill:** solo en una estación independiente. **Si no hay ninguna disponible, la restauración real se difiere**: OR-1 se detiene tras la Fase 0, NB-6 y G-C2 siguen bloqueadas, y no se ejecutan las Fases 2–5. Una restauración en el host compartido requiere una evaluación separada y una autorización propia; este plan no la autoriza.

**Cierre:** nota de inventario. No se modifica nada.

### Fase 1 · Restore drill previo a cualquier cambio (bloqueante, P-C)

Prueba que la identidad **actual** recupera respaldos de **todo el periodo de retención**.

1. Muestra mínima: el Monthly más antiguo, el Monthly más reciente, el Daily más antiguo, el Daily más reciente y el Frequent más reciente.
2. Para cada uno: verificar el sidecar, descifrar a la carpeta temporal, `pg_restore -l` y, si es un paquete 7z, listar su contenido.
Todo se ejecuta en la **estación independiente**; los artefactos `.age` se copian a ella y la identidad se usa desde su copia de custodia.

3. Restauración completa del **Daily más reciente** y del **Monthly más antiguo** en un **clúster desechable** de la estación independiente (`initdb` en carpeta temporal, puerto no estándar, solo `localhost`), **nunca** en el host productor, en el clúster `postgresql-x64-18` ni en `daubert_global`/`daubert_hub_test`. Comprobación: conteo de tablas y filas de control frente al catálogo de `pg_restore -l`.
4. Detener y borrar el clúster desechable y la carpeta temporal; verificar que no quedan archivos en texto plano.

**Criterio de éxito:** los cinco artefactos descifran y listan; las dos restauraciones completan sin errores. **Si alguno falla, OR-1 se detiene** y se trata primero como incidente de recuperabilidad.

### Fase 2 · Copias offline verificadas (antes de tocar permisos)

1. Crear **dos** copias de la identidad (y de su `.sha256`) en dos medios offline distintos, custodiados en lugares distintos.
2. Verificar cada copia por SHA-256 **y** descifrando el Frequent más reciente **desde la copia**.
3. Registrar custodio, ubicación y fecha (sin rutas que revelen el contenido).

### Fase 3 · Retirar el acceso de agentes y sandbox

1. Guardar la ACL actual de `RECOVERY\KEYS` (`icacls ... /save`) como reversión.
2. En `RECOVERY\KEYS` solamente: romper la herencia **copiando** las entradas y eliminar `CodexSandboxUsers`.
3. Verificar por metadatos: `06` conserva lectura; `CodexSandboxUsers` no aparece. Prueba de humo: descifrar el Frequent más reciente desde la ubicación original.
4. **Reversión:** `icacls ... /restore` con la ACL guardada.

Limitación: la ACL es local. La copia en la nube de Dropbox y su historial de versiones siguen existiendo; lo resuelve la Fase 4.

### Fase 4 · Sacar la identidad de Dropbox

**Precondición:** Fases 1–3 superadas y las dos copias offline verificadas.

1. Quitar la identidad de la carpeta sincronizada; queda solo en custodia offline (y, si el operador lo decide, en una estación de recuperación que no sea el host productor).
2. Tener en cuenta que Dropbox conserva archivos borrados y versiones durante un tiempo según el plan de la cuenta: la identidad sigue siendo recuperable desde la cuenta durante ese periodo.
3. Desde este momento los restore drills y la Fase 1 futura usan la copia offline.

Consecuencia operativa: NB-6 queda satisfecho; el host ya no puede descifrar sus propios respaldos (coherente con el diseño original del pipeline).

### Fase 5 · Rotación (condicional)

**Se ejecuta si** la identidad **no** tiene frase de paso, o si el operador considera material la exposición a `CodexSandboxUsers` y a la nube de Dropbox.

1. Generar un par nuevo en una estación distinta del host productor (procedimiento existente de la documentación de respaldos); custodiarlo según la Fase 2.
2. Cambiar `%ProgramData%\DaubertHub\Backup\age-recipients.txt` al recipient nuevo; ejecutar `Test-DaubertBackupEnvironment.ps1` (PASS) y esperar al siguiente Frequent.
3. Drill con la identidad **nueva** sobre ese Frequent (Fase 1, pasos 2 y 4).
4. **La identidad antigua se conserva offline** hasta que la retención haya eliminado el último respaldo cifrado con ella (Monthly: 12 meses después del cambio), y se repite la Fase 1 con ella antes de destruirla.
5. **Reversión:** restaurar el recipient anterior en `age-recipients.txt`.

---

## OR-2 · Dependencia de PROD del inicio de sesión

**Objetivo:** que un reinicio del host no deje PROD caído sin que nadie lo sepa, y reducir los reinicios no planificados. El objetivo final (motor sin sesión o servidor dedicado) requiere su propio ADR.

**Hechos [F]:** Docker Desktop arranca con la sesión de `06`; `AutoAdminLogon=0`; la tarea n8n Supervisor es interactiva; los respaldos PostgreSQL usan S4U y sí corren sin sesión. **[H]** El reinicio del 2026-11-24 12:58 pudo ser Windows Update; no está confirmado.

**Rechazado:** inicio de sesión automático de una cuenta administradora (deja una sesión privilegiada sin presencia humana y expone credenciales en el registro).

### Fase 0 · Diagnóstico (solo lectura)

1. Confirmar la causa del último reinicio: eventos 1074, 6005/6006, 6008 y 41 del registro System y eventos del cliente de Windows Update.
2. Inventariar la política actual de Windows Update (horas activas, reinicio automático, aplazamientos).
3. Confirmar la política de reinicio de los contenedores de PROD en los archivos Compose y el ajuste de inicio automático de Docker Desktop.
4. Medir el tiempo desde el inicio de sesión hasta PROD sano (para el runbook).

### Fase 1 · Control de reinicios (cambio de configuración del host)

1. Horas activas que cubran el horario de uso del Hub y **sin reinicio automático con sesión iniciada**; reinicios solo manuales.
2. Ventana de mantenimiento mensual para parches, con runbook: reiniciar, iniciar sesión `06`, verificar PROD (snapshot V4 cuando exista; mientras tanto, los checks del runbook actual).
3. **[R]** Evaluar un SAI (UPS) si la Fase 0 muestra cortes de energía (eventos 41/6008).
4. **Reversión:** restaurar la política inventariada en la Fase 0.

### Fase 2 · Monitoreo externo

**Decisión del operador (2026-11-24):** el monitoreo es **externo e independiente del host, de Docker y de n8n**. Detecta la **ausencia de heartbeat** o la **indisponibilidad del servicio** y avisa **por correo** y, si es posible, **por notificación push**. El proveedor está pendiente de selección.

1. **Detección en el proveedor externo, no en el host.** Un host caído, apagado o sin sesión no puede avisar de sí mismo; por eso la alarma la genera el proveedor cuando deja de recibir el heartbeat.
2. **Heartbeat desde el host:** tarea programada periódica en modo S4U (sin sesión), **solo lectura**. Comprueba si el motor Docker responde y si los endpoints de salud de PROD contestan, y envía el heartbeat **solo si PROD está sano** (o envía el estado y el proveedor alerta según él). No arranca nada ni inicia sesión. Registra evidencia local en `%ProgramData%\DaubertHub\Watchdog\`.
3. **Indisponibilidad del servicio:** además del heartbeat, una comprobación HTTP desde el proveedor **solo si** el Hub es alcanzable desde fuera de forma segura; hoy no está evaluado y no se abre ningún puerto para esto.
4. **Requisitos para elegir proveedor:** alertas por correo y push; detección de heartbeat ausente con periodo y gracia configurables; la URL o token del heartbeat se trata como secreto (fuera del repositorio, nunca en logs ni evidencias); el heartbeat no envía datos del negocio ni del host más allá del estado; funciona sin cuentas ni servicios del host.
5. El script del heartbeat se implementa en un PR propio con pruebas Pester cuando se elija el proveedor; más adelante su lógica de observación se absorbe como observador C0 del orquestador.

### Fase 3 · Medio plazo (requiere ADR propio)

Motor de contenedores que arranque sin sesión, o PROD en un servidor dedicado (objetivo de DF-10). Ninguna de las dos opciones se ejecuta sin ADR y ventana aprobada.

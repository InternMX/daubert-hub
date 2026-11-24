# Modelo de capacidades y compuertas

- **Status:** Propuesto (desarrolla DF-13, DF-14 y DF-15 de [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md)).
- **Fecha:** 2026-11-24

Este documento define qué puede hacer el orquestador, en qué modo y con qué evidencia. Es la especificación del **registro de compuertas** que el motor aplicará técnicamente.

## 1. Escalera de validación

| Nivel | Dónde | Qué es real | Qué es simulado | Riesgo para PROD |
|---|---|---|---|---|
| **V0 · Simulación** | Proceso de pruebas | Lógica del motor | Mundo, adaptadores y E/S | Nulo |
| **V1 · Procesos sintéticos** | Carpeta temporal del host, sin Docker | Node, PowerShell 5.1, NTFS, handles, `taskkill` | Scripts de infraestructura (fixtures que imitan los contratos) | Nulo |
| **V2 · Docker sintético** | Motor compartido, proyecto `daubert-orch-sandbox` | `docker tag`, `compose up`, recreación, health | El Hub (imágenes mínimas que imitan `/api/health`) | Bajo, solo con las restricciones de §2 |
| **V3 · TEST** | Pila TEST real | Hub TEST, cierre, Switch | Nada | Bajo, solo con las restricciones de §2 |
| **V4 · PROD solo lectura** | PROD | Observación | Nada | Acotado por comprobaciones previas en V3 (G-C0a); demostrado nulo tras la validación posterior en V4 (G-C0b) |
| **V5 · PROD supervisado** | PROD | Todo | Nada | Controlado por las compuertas |
| *VX · Laboratorio externo (futuro)* | Equipo dedicado | Fallos del motor Docker, del SO y de la energía | Nada | Nulo |

Las suites de prueba se etiquetan por nivel. Lo que solo puede probarse en VX (fallos del motor Docker a mitad de una operación, `wsl --shutdown`, caídas del sistema, cortes de energía) se compensa con los riesgos RA-1 y RA-2 del [registro de riesgos](risk-register.md), propuestos y pendientes de aceptación.

## 2. Restricciones para pruebas en el host compartido

### 2.1 Principio (precisión P-A)

La huella de PROD **detecta** un daño después de que ocurre; **no lo previene**. La seguridad de V2 y V3 descansa en las restricciones **preventivas** (§2.2), comprobadas antes de cada paso. La huella es la segunda línea.

### 2.2 Restricciones preventivas (obligatorias antes de cada paso mutante en V2/V3)

Las aplica el motor; no son reglas escritas. Cada una tiene su prueba negativa en V0/V1 (NB-3).

1. **Alcance por etiqueta y nombre.** En V2 solo se aceptan comandos cuyos objetivos tengan la etiqueta `daubert.sandbox=true`, el prefijo `daubert-orch-sandbox-*` y el proyecto Compose `daubert-orch-sandbox`. En V3 solo el proyecto `daubert-hub-test` y las imágenes `daubert-hub-test-*`. El motor resuelve los objetivos **antes** de ejecutar y rechaza si alguno queda fuera.
2. **Lista negra absoluta**, en todos los perfiles y modos: `docker system *`, `docker * prune`, `docker rmi`, `docker rm`, `docker compose down`, `--remove-orphans`, cambios de contexto o de red de Docker, reiniciar o actualizar Docker Desktop, `wsl --shutdown`/`--terminate`, detener servicios del host (PostgreSQL, n8n, Docker).
3. **Compuerta de recursos:** RAM disponible, disco libre del motor Docker y del volumen de PostgreSQL por encima de umbrales del perfil, y ningún respaldo en curso (`BackupLock`).
4. **Ventana horaria** configurable fuera del horario de uso del Hub para pruebas V2/V3 pesadas.
5. **Aprobación específica** de cada prueba mutante V2/V3: ligada a la suite, el perfil y la huella inicial. Una aprobación no se reutiliza para otra prueba.

### 2.3 Pruebas prohibidas en este host

Cualquier prueba cuyo propósito o efecto previsible sea afectar al motor Docker compartido o a servicios productivos: inyectar fallos en el daemon, reiniciar Docker Desktop o WSL, agotar memoria o disco, matar procesos del motor, alterar redes. Pasan a VX.

### 2.4 Huella de PROD (detección)

Antes y después de cada paso mutante en V2/V3 el motor registra:

- ID, `StartedAt` y `RestartCount` de los contenedores de PROD;
- IDs de imagen de `:latest`, `release-*` y `rollback-*` de PROD;
- hash de la configuración de Nginx de PROD;
- existencia y hash del overlay de PROD.

Cualquier cambio → la prueba se detiene, la ejecución pasa a `Escalated` y no hay más pasos. El operador decide.

## 3. Clases de capacidad

| Clase | Capacidades | Evidencia exigida | Modo máximo TEST / PROD |
|---|---|---|---|
| **C0 · Observar** | `status`, drift, `plan`, `report`, `verify-journal`, invariantes de host (DF-14) | **Previa:** V0 + V1 + AC1 en V3 (G-C0a). **Posterior:** AC9 en V4 (G-C0b) | Automático / **Supervisado (invocación manual) tras G-C0a; Automático tras G-C0b** |
| **C1 · Registrar** | Journal, aprobaciones, empaquetado de evidencias, correlación pasiva de artefactos de respaldo | V0 + V1 (J1 superada) | Supervisado / Supervisado |
| **C2 · Efectos rutinarios no destructivos** | Disparar el respaldo Frequent, verificador de restauración aislada (con el modelo de [acceso temporal a la identidad](remediation-or1-or2.md#or-1--c2--verificación-de-restauración-tras-retirar-la-identidad-del-host)), sondas de cierre | V1 + V2 + V3 + **OR-1 resuelto** | Supervisado / **Supervisado tras G-C2** |
| **C3 · Mutaciones reversibles del runtime** | Cierre Close/Open/Reload, Deploy con anclas, Switch Enable/Disable, compensaciones R0 y R1 | Matriz de fallos en V0/V1 + cortes del orquestador en V2 + ensayos V3 con corte en cada frontera de intent + R0/R1 ejecutados en V3 + **OR-4 resuelto** | Supervisado / **Guiado hasta G-C3; Supervisado después** |
| **C4 · Alto riesgo o difícil de revertir** | R2 en PROD, migraciones, n8n, reubicar la raíz operativa, forzar la continuación tras `Uncertain`, recuperar un journal corrupto | Lo de C3 + laboratorio externo **o** ADR específico con evidencia equivalente + doble aprobación | Guiado / **Guiado** |

## 4. Modos de operación

| Modo | Quién ejecuta el efecto | Qué hace el orquestador |
|---|---|---|
| **Observar** | Nadie | Snapshot, drift, plan. |
| **Guiado** | El operador, en su consola elevada | Muestra el comando exacto generado desde el perfil y las herramientas fijadas; registra el intent **declarado** por el operador antes de ejecutar; después observa, verifica poscondiciones, registra resultado y evidencias y aplica las compuertas del paso siguiente. |
| **Supervisado** | El motor, vía adaptador, tras aprobación por paso | Todo lo anterior, ejecutando él mismo la acción. |
| **Automático** | El motor | Solo C0. |

**Límite del modo guiado (RA-6):** el motor no sabe qué comando ejecutó realmente el operador. Si las poscondiciones observadas no coinciden con las esperadas, el paso queda en `Diverged`; si no puede decidirse, en `Uncertain`. En ambos casos la ejecución se suspende.

Un procedimiento puede mezclar modos: en `hub-release` sobre PROD, respaldo y verificador (C2) pueden ir supervisados tras G-C2 mientras Deploy y Switch (C3) van guiados.

## 5. Compuertas

| Compuerta | Habilita | Condiciones | Quién la cierra |
|---|---|---|---|
| **G-C0a** (previa) | C0 en PROD solo por invocación manual supervisada, con el operador presente | AC1 demostrado en **V3** (cero eventos Docker, cero escrituras en raíces gestionadas, refs y hashes intactos) + prueba de arquitectura y lista blanca de comandos + revisión de Codex. No usa ninguna evidencia de V4 | Operador |
| **G-C0b** (posterior) | C0 automático en PROD | AC9: las primeras ejecuciones manuales en V4 (al menos una por comando C0) muestran cero efectos, medidos **de forma independiente del orquestador** (captura de `docker events` en otra consola y hashes/refs de las raíces gestionadas tomados antes y después por el operador). Si cualquier ejecución muestra un efecto, C0 en PROD vuelve a denegado y se abre un incidente | Operador |
| **G-C1** | C1 en TEST y PROD | J1 superada (P1–P12, P13a–c) + RA-1 aceptado | Operador |
| **G-C2** | C2 supervisado en PROD | Evidencia de C2 + OR-1 ejecutado (incluido el restore drill previo) + modelo de [acceso temporal a la identidad](remediation-or1-or2.md#or-1--c2--verificación-de-restauración-tras-retirar-la-identidad-del-host) probado en la estación de recuperación + NB-5 y NB-6 satisfechos | Operador |
| **G-C3** | C3 supervisado en PROD, paso a paso | Evidencia completa de C3 + OR-4 en M4 + auditoría de Codex + GO explícito del operador | Operador |
| **G-C4** | C4 supervisado | Laboratorio o ADR específico + doble aprobación implementada | Operador + segundo aprobador |

## 6. Registro de compuertas (DF-15)

### 6.1 Formato

Archivo versionado dentro del paquete del orquestador (`orchestrator/gates/capabilities.json`), incluido en el manifiesto de hashes de la instalación. Esquema conceptual:

```json
{
  "schema": "daubert-orch-capabilities/1",
  "capabilities": {
    "deploy.apply": {
      "class": "C3",
      "maxMode": { "test": "supervised", "prod": "guided" },
      "evidence": ["V0:deploy-fault-matrix", "V3:hub-release-rehearsal"],
      "risks": ["RA-2", "RA-3", "RA-6"],
      "gate": "G-C3"
    }
  }
}
```

### 6.2 Reglas

1. **Por defecto todo está denegado.** Una capacidad ausente del registro no se ejecuta en ningún modo.
2. El motor compara el modo solicitado con `maxMode[entorno]` **antes** de registrar el intent, y rechaza si lo supera. El rechazo se registra en el journal.
3. Una capacidad solo puede subir de modo si **todos** sus riesgos tienen una aceptación registrada vigente (NB-7) y todas sus evidencias están referenciadas.
4. El registro solo cambia mediante PR revisado y una nueva instalación versionada; el motor verifica su hash contra el manifiesto al arrancar. No hay override por línea de comandos ni por variable de entorno.
5. Bajar el modo de una capacidad (p. ej. tras un incidente) también es un PR, pero puede publicarse de inmediato.
6. Una prueba negativa (condición 6 de V1-útil) demuestra que el motor rechaza un paso C2 o C3 supervisado en PROD mientras su compuerta está cerrada.

## 7. Laboratorio futuro

Un laboratorio se añade como perfil `kind: lab`, con su propio endpoint de Docker, raíces, datos sintéticos y una identidad age exclusiva de laboratorio. Nunca recibe datos ni claves de PROD. Sus evidencias (VX) se referencian en el registro como cualquier otra y pueden elevar el modo de una capacidad (por ejemplo C4 de guiado a supervisado), sin cambiar motor, journal ni procedimientos.

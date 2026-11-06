# Caterpillar — Diagnóstico: visualización de «Último error» en Ejecuciones recientes

Estado: **implementado en el PR `fix/caterpillar-error-display`** (solo frontend). Prioridad P2 (usabilidad). Independiente de la recuperación de folios y desplegable por separado.

## 1. Archivos responsables

| Capa | Archivo | Rol |
| --- | --- | --- |
| UI | `apps/web/src/automations/CaterpillarRemissionsPage.tsx` | Tabla «Ejecuciones recientes» (~l. 294-325) y `ExecutionDetailDialog` (~l. 380+) |
| Servicio web | `apps/web/src/services/caterpillarRemissions.ts` | Tipos y cliente HTTP |
| API | `apps/api/src/automations/remisiones-caterpillar/caterpillar-executions.repository.ts` / `.service.ts` | `error_mensaje AS error_message` → `latestErrorMessage` |
| Pruebas | `CaterpillarRemissionsPage.test.tsx`, `caterpillarRemissions.test.ts` | Cobertura actual |

## 2. Cómo se renderiza hoy «Último error»

```tsx
<TableCell sx={{ overflowWrap: 'anywhere' }}>{execution.latestErrorMessage ?? '—'}</TableCell>
```

Se inserta el texto completo como hijo de la celda. Las ocho columnas, su orden y el resto de celdas son correctos.

## 3. Causa del desbordamiento

1. La celda no limita el alto: el mensaje (miles de caracteres, con saltos de línea y rutas) se pinta entero y la fila crece hasta contenerlo.
2. `overflowWrap: 'anywhere'` evita el desborde horizontal de rutas largas pero **agrava** el alto, porque rompe en cualquier carácter.
3. El ancho de la columna lo decide el contenido (tabla `auto`), de modo que el error compite con las otras siete columnas.
4. El mismo problema existe en el diálogo de detalle: `Mensaje de error` usa `<Typography variant="body2">` sin `white-space: pre-wrap` ni altura máxima, por lo que los saltos de línea del mensaje se pierden (se colapsan) y el stack trace queda ilegible.

El API devuelve el valor tal cual; **no trunca**. El mensaje de la ejecución 27 ya viene recortado por n8n al guardarse (termina en «…failed to install with rea»), pero aun así es de miles de caracteres.

## 4. Relación estado ↔ error (hallazgos, sin cambiar reglas)

| Estado | ¿Conserva error? | Evidencia |
| --- | --- | --- |
| `COMPLETADA` | **No**: `error_nodo`/`error_mensaje` quedan NULL; `fn_finalizar` rechaza `COMPLETADA` con error no vacío. | `caterpillar-execution-finalization.integration.runner.cjs` (#19, #~418) |
| `ERROR` | Sí: nodo y mensaje persistidos exactamente como se enviaron; mensaje en blanco es rechazado. | mismo runner (#~274, #~291) |
| `CANCELADA` | No: campos NULL. | mismo runner (#20) |
| `PROCESANDO` tras un fallo no final | **No verificado**: el cuerpo de `fn_registrar_fallo_ejecucion` no está en el repositorio y su ficha solo habla de incrementar intentos. Requiere una consulta de solo lectura (o prueba en TEST). | — |
| Original con reproceso | La original es inmutable: **conserva** su error y su estado; la hija tiene el suyo propio. | `reprocessing.md`; la UI muestra «Reproceso de» en el detalle |

Conclusiones:
- Que una ejecución `COMPLETADA` no muestre errores es **intencional y consistente** con el modelo; el historial de errores de intentos previos no se conserva en esa fila.
- La frontend ya asocia el error a la ejecución correcta: toma `error_mensaje` de la misma fila (`ejecucion_id`), sin cruces con el padre o el hijo. No se ocultan errores por existir un reproceso.
- La lista (`mapSummary`) y el detalle (`getDetail`) ya devuelven `latestErrorNode`, `latestErrorMessage`, `outcome`, `startedAt`, `sourceFilename` y `processLabel`; con eso el diálogo se puede alimentar **sin llamadas nuevas**.

## 5. Propuesta de implementación mínima

**Tabla (misma estructura de 8 columnas):**
- La celda «Último error» pasa a un contenedor con ancho máximo (p. ej. `maxWidth: 280`, `minWidth: 160`) y texto limitado a **2 líneas** con `-webkit-line-clamp: 2`, `display: -webkit-box`, `overflow: hidden`, `overflowWrap: anywhere`, `whiteSpace: normal`. El valor original no se altera (solo CSS).
- Debajo, un botón de texto **«Ver error»** (solo si hay error), con `aria-label="Ver error de la ejecución #27"`, y `stopPropagation` para no abrir además el detalle de la fila (la fila ya es clicable).
- Sin error: `—`.
- Opcional: `title` con las primeras ~300 caracteres como apoyo en escritorio (el contenido completo vive en el diálogo).

**Diálogo `ExecutionErrorDetailDialog` (MUI):**
- Título «Detalle del error — Ejecución #27», `fullWidth`, `maxWidth="md"`, `fullScreen` en `xs` (`useMediaQuery(theme.breakpoints.down('sm'))`), `scroll="paper"`.
- Metadatos con el `MetaRow` existente: ID, fecha, archivo, proceso/planta, estado (`OutcomeChip`), nodo (si existe).
- Mensaje completo en `<Box component="pre">` con `whiteSpace: 'pre-wrap'`, `overflowWrap: 'anywhere'`, `fontFamily: monospace`, `maxHeight` con `overflowY: auto` (`tabIndex={0}` para desplazarlo con teclado). React escapa el texto: no se ejecuta HTML.
- Acciones: **Copiar error** (`navigator.clipboard.writeText(mensaje completo)` con aviso «Copiado» y respaldo si el portapapeles no está disponible) y **Cerrar**.
- Foco: lo gestiona MUI (se devuelve al botón «Ver error»).

## 6. Componente reutilizable

Crear `apps/web/src/automations/ExecutionErrorDetailDialog.tsx`, genérico por props (`open`, `onClose`, `title`, `fields: {label, value}[]`, `message`, `node`). Hoy solo Caterpillar muestra un error por ejecución en tabla; Audi **no** tiene columna de error y Pagos usa un estado propio sin mensaje largo, así que el reuso inmediato es: (a) la tabla y (b) el bloque «Mensaje de error» del `ExecutionDetailDialog` de Caterpillar (que también debe usar `pre-wrap`). Ambas páginas tienen su propia copia de `MetaRow`; unificarla es mejora opcional, no necesaria para este alcance. Un `ErrorPreview` interno (celda con clamp + botón) puede vivir en el mismo archivo.

## 7. Cambios necesarios en API

**Ninguno.** El valor ya viaja íntegro y con nodo/estado/fecha/archivo/proceso en la lista. No truncar en el servidor (se perdería información diagnóstica). Única consideración futura: si algún día se quisiera aligerar la lista, enviar solo un extracto y cargar el completo desde el detalle; no se recomienda ahora.

## 8. Cambios de frontend

1. Nuevo `ExecutionErrorDetailDialog.tsx` (+ pruebas).
2. En `CaterpillarRemissionsPage.tsx`: reemplazar la celda de error y manejar el estado `errorExecution` en el componente de la tabla.
3. En el detalle, mostrar el mensaje con `pre-wrap`, sin cambiar el resto.
4. Ninguna columna nueva; no se tocan Fecha, Archivo, Proceso, Estado, Intentos, Remisiones ni Folio(s).

## 9. Pruebas a agregar (Vitest + Testing Library)

Unitarias/componente: sin error (`—`, sin botón); error de una línea; error >5 000 caracteres (la celda tiene clamp, el texto completo en el diálogo `textContent` igual al original); saltos de línea (conservados en el diálogo); rutas largas de Windows y cadenas sin espacios (sin `scrollWidth > clientWidth` en la celda en jsdom con estilos, y verificación de las propiedades CSS); stack trace de PowerShell; abrir/cerrar con clic, `Enter`/`Space` y `Escape`; copia con `navigator.clipboard.writeText` llamado con el mensaje **exacto**; estados `PROCESANDO`, `COMPLETADA`, `ERROR`; ejecución con `reprocessOfExecutionId`; el clic en «Ver error» no abre el detalle de la fila; HTML dentro del mensaje se muestra como texto (`<img onerror>` no crea nodos).
Visuales/e2e (Playwright o la herramienta ya usada por el proyecto): altura de fila acotada con mensaje de 5 000 caracteres; viewports 360 px, 768 px, 1280 px y zoom 200 %; sin desplazamiento horizontal de la página en escritorio.

## 10. Estimación y compatibilidad

- Esfuerzo: **≈ 1–1.5 días** (componente 0.5, integración 0.25, pruebas 0.5, ajustes responsive/zoom 0.25).
- Compatibilidad: usa solo componentes MUI ya presentes (`Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`, `Button`, `Box`, `Typography`, `Snackbar`) y el tema actual; mantiene `OutcomeChip`, el contenedor `overflowX: auto` y el comportamiento de fila clicable. Despliegue independiente: solo `apps/web`, sin migraciones ni cambios en n8n.

## Riesgos y notas

- `-webkit-line-clamp` es estándar de facto en todos los navegadores actuales; si se quisiera evitar prefijos, se puede usar `maxHeight` con `overflow: hidden`.
- El botón dentro de una fila clicable requiere `stopPropagation` y cuidar el orden de tabulación.
- Pendiente de verificar con datos: si `fn_registrar_fallo_ejecucion` guarda el mensaje en intentos no finales (afecta qué se ve en `PROCESANDO`).

## Implementación (PR `fix/caterpillar-error-display`)

Solo frontend, sin cambios de API, PostgreSQL, n8n, dependencias ni reglas de estados.

| Archivo | Cambio |
| --- | --- |
| `apps/web/src/automations/ExecutionErrorDetailDialog.tsx` (nuevo) | `ExecutionErrorDetailDialog` (MUI: ID, fecha, archivo, proceso, estado, nodo y mensaje completo; «Copiar error» y «Cerrar»; pantalla completa en móvil), `ExecutionErrorPreview` (celda: «—» o 2 líneas + «Ver error») y `ExecutionErrorMessage` (`<pre>` con `pre-wrap`, desplazable y enfocable) |
| `apps/web/src/automations/executionErrorPresentation.ts` (nuevo) | Constantes `sx` de la celda y del recorte a 2 líneas |
| `apps/web/src/automations/CaterpillarRemissionsPage.tsx` | La celda «Último error» usa `ExecutionErrorPreview`; el diálogo se abre con un snapshot de la fila pulsada; el «Mensaje de error» del detalle existente usa `ExecutionErrorMessage` |
| Pruebas | `ExecutionErrorDetailDialog.test.tsx` (14) y bloque «long errors in recent executions» en `CaterpillarRemissionsPage.test.tsx` (8) |

Notas de diseño:
- El recorte es solo CSS (`-webkit-line-clamp: 2`, `overflow-wrap: anywhere`, ancho 180–280 px): el valor completo permanece en el DOM y en memoria, y es el que se copia.
- «Ver error» detiene la propagación del clic para no abrir además el detalle de la fila.
- El texto se renderiza como texto de React: el HTML contenido en un error no se interpreta.
- Audi y Pagos no tienen columna de error en tabla; el componente queda disponible para ellos sin duplicarlo.

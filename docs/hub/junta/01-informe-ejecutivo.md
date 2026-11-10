# Gestor de Hojas de Manufactura · informe ejecutivo para la junta de autorización

**Qué se pide a la junta:** autorizar la liberación a producción, rechazarla o solicitar cambios. Hoy **nada está desplegado**: Daubert Hub productivo sigue en la versión 1.1.1 y el módulo de Manufactura está apagado.

## 1. Problema operativo que resuelve
Las Hojas de Instrucción de Manufactura se elaboran hoy en un libro de Excel con ocho pestañas (una por formato). Cada hoja exige volver a capturar a mano datos que ya existen en BIND (código, descripción, medidas, calibre, peso), no queda registro de quién la elaboró, revisó y aprobó, no hay control de revisiones ni un lugar único donde consultar la versión vigente, y el resultado depende de que el archivo de Excel no se altere.

## 2. Funcionalidades desarrolladas
- **Consulta del producto en BIND** por código DCMX y lista de novedades del catálogo (solo lectura).
- **Prellenado inteligente**: interpreta el título, la descripción y el peso del producto; distingue lo «listo», lo «sugerido por revisar» y lo que falta; no inventa datos ni elige al azar cuando la información es contradictoria.
- **Ocho formatos**: Bolsa Plana 1, Hojas, Bolsa Fuelle, Bolsa Natural, Rollo Continuo, Termoencogible, COEX Azul y COEX Verde.
- **Borradores con autoguardado** y consulta de los borradores del equipo (solo lectura para quien no es su autor).
- **Responsables Generó / Revisó / Aprobó**, con firmas digitalizadas administradas y autorizadas por usuario.
- **Finalización**: genera el PDF definitivo, lo guarda en la base de datos y la hoja queda inmutable. Los cambios posteriores se hacen como **nueva revisión** con historial.
- **Roles**: GENERAL (elabora y consulta) y ADMIN (además administra clientes, abreviaturas y firmas).
- **Catálogo de clientes y abreviaturas** para sugerir el cliente a partir del código.
- Hojas emitidas visibles en **Actividad reciente**.

## 3. Beneficios esperados
- Menos captura manual y menos errores de transcripción desde BIND.
- Un solo formato controlado por tipo de producto, sin depender de un archivo editable.
- Trazabilidad: quién generó, revisó y aprobó cada hoja, y cuándo.
- Historial de revisiones y PDF definitivo siempre recuperable.
- Las hojas quedan incluidas en los respaldos cifrados del Hub.
No se han medido tiempos ni ahorros; cualquier cifra tendría que salir del uso real después de la liberación.

## 4. Demostración propuesta
Sesión de 30 a 40 minutos en el ambiente de **pruebas** (no en producción), siguiendo `02-guia-demostracion.md`: buscar un producto, revisar el prellenado, guardar un borrador, asignar responsables y firmas, finalizar, descargar el PDF, crear una nueva revisión y mostrar la administración de clientes y abreviaturas con una cuenta GENERAL y una ADMIN.

## 5. Evidencias técnicas relevantes
| Tema | Resultado |
|---|---|
| Pruebas automáticas del código | API 3 043 y web 1 816 pruebas en verde; 120 pruebas de los procedimientos de despliegue |
| Migraciones de base de datos (020–024 y 026) | Aplicadas en orden sobre copias desechables del respaldo real; los datos ajenos a Manufactura quedaron idénticos antes y después |
| Recorrido funcional | 82 comprobaciones con el simulador de BIND; 30 en navegador real |
| Ocho formatos PDF | 152 controles automáticos correctos (una página, tamaño Carta, fuentes incrustadas, firmas). **La revisión visual por Manufactura está pendiente** |
| Despliegue y reversión | Ensayados completos en un entorno aislado: volver a la versión 1.1.1 funciona incluso con la base ya migrada y con hojas emitidas |
| Respaldos | Ciclo completo cifrado → descifrado → restauración comprobado con claves de prueba; se detectó y cubrió un caso en que el respaldo «termina bien» pero incompleto |
| Seguridad | Manufactura apagada por omisión en producción; acceso por rol; el mantenimiento bloquea las escrituras del módulo |
| Producción | Sin cambios: versión 1.1.1, sin migraciones, sin el parche de respaldos, sin tareas programadas modificadas |

## 6. Decisiones de negocio pendientes
1. **Aprobación visual de los ocho PDF** (`03-revision-ocho-formatos.md`). Hay diferencias visibles frente al Excel que solo Manufactura puede aceptar o rechazar: tipo de letra Carlito en lugar de Calibri, tres responsables en lugar de dos, celdas de rótulo en azul marino, posición del formulario en la hoja.
2. **Proceso Generó / Revisó / Aprobó**: quién ocupa cada función y qué firmas se dan de alta.
3. **Catálogo de clientes y abreviaturas**: carga inicial y quién lo mantiene. La captura manual de un cliente que no está en el catálogo sigue permitida (decisión previa), con el riesgo de calidad de datos que implica.
4. **BIND real**: autorizar la comprobación de solo lectura (`04-bind-real.md`) y quién entrega las credenciales de forma segura.
5. **Pruebas pendientes de módulos existentes** (Caterpillar, Pagos, Actividad reciente, Audi): corregirlas antes o aceptarlas por escrito (`05-regresiones-operativas.md`).
6. **Fecha y ventana de mantenimiento**, y quién custodia la clave de los respaldos ese día.

## 7. Riesgos conocidos y mitigación
| Riesgo | Mitigación |
|---|---|
| El PDF no coincide con lo que Manufactura espera | No se libera sin la ficha de aprobación de cada formato |
| Falla la generación de PDF en producción | Las hojas ya finalizadas siguen disponibles; la que falla queda como borrador editable; el módulo puede apagarse sin perder datos |
| La nueva versión no arranca | Vuelta a la 1.1.1 con las imágenes de respaldo; ensayado |
| Respaldo incompleto después de migrar | El respaldo solo se da por bueno tras descifrarlo y restaurarlo en una copia aislada |
| Regresión en Caterpillar, Pagos o Audi | El código de esos módulos no cambió; faltan pruebas de integración vigentes (ver decisión 5) |
| BIND real se comporta distinto al simulador | Comprobación de solo lectura antes de habilitar; sin BIND el resto del módulo funciona con captura manual |
| Cliente capturado a mano con errores | Solo ADMIN administra el catálogo; revisión posterior de hojas con cliente no verificado |

## 8. Si se aprueba la liberación
1. Se congela la versión candidata (1.2.0) y se construyen y validan las imágenes definitivas.
2. Ventana de mantenimiento: respaldo previo comprobado → pausa de respaldos automáticos → migraciones → respaldo nuevo comprobado → despliegue con Manufactura **apagada**.
3. Con el sistema estable, y en un paso aparte, se **habilita** Manufactura y se repite la comprobación funcional.
4. Las hojas se elaboran en el Hub; el Excel queda como referencia.

## 9. Si se solicitan cambios
Se registran en las fichas, se implementan en la rama de trabajo, se repiten las pruebas afectadas y se vuelve a presentar. Producción no cambia mientras tanto.

## 10. Criterios para autorizar producción
- [ ] Los ocho formatos con ficha **APROBADO** firmada por Manufactura.
- [ ] Flujo de trabajo aceptado por los usuarios en la demostración (lista de aceptación).
- [ ] BIND real comprobado, o aceptación expresa de iniciar con captura manual.
- [ ] Catálogo inicial de clientes y abreviaturas definido, con responsable.
- [ ] Pruebas pendientes de módulos existentes corregidas o aceptadas por escrito.
- [ ] Ventana de mantenimiento, responsables y custodio de la clave de respaldos designados.
- [ ] Autorización formal firmada, con los identificadores (hashes) de la versión que se despliega.

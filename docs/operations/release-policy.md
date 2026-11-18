# Política de versionado y releases supervisados

Fase 3C: reglas documentales para identificar, aprobar y registrar una publicación de
Daubert Hub. **No implementa controles nuevos ni autoriza acciones productivas.**
[deployment-checklist](deployment-checklist.md) sigue siendo la autoridad del procedimiento
PROD; [release-pipeline](release-pipeline.md) describe las automatizaciones existentes.
La decisión de publicar, la aprobación del SHA y la ejecución continúan siendo humanas.

## 1. Identificadores que no deben confundirse

| Identificador | Qué representa | Fuente y límite |
| --- | --- | --- |
| Versión de aplicación, `MAJOR.MINOR.PATCH` | La entrega funcional declarada, por ejemplo `1.1.1` | `package.json` raíz y metadatos de build; `/api/health` informa la versión en ejecución. No identifica por sí sola un commit ni prueba un despliegue |
| SHA de Git | Un commit exacto de código/configuración versionada | Para aprobar, registrar los 40 caracteres. El orquestador exige `-ExpectedCommit` completo; un nombre de rama o tag no lo sustituye |
| Tag | Un nombre de Git que apunta a un commit | Es una referencia de trazabilidad, no un entorno ni una comprobación de health. Resolver siempre el commit del tag, especialmente si es anotado |
| Commit efectivamente desplegado | El build que se comprobó en PROD durante una ventana concreta | Vincular el SHA de health —actualmente corto— con el SHA completo aprobado y el expediente. No deducirlo de `main`, del tag más reciente ni del último CI verde |

Un mismo commit puede contener documentación y código; una misma versión histórica puede
haber aparecido en más de un commit. Por ello, el expediente registra **versión, SHA completo,
entorno, fecha y resultado**, además de la relación con CI, PR y anclas por digest.
Un tag tampoco fija las imágenes base o dependencias externas de un build: para rollback
exacto mandan las imágenes preservadas y sus digests según el checklist, no reconstruir Git.

## 2. Versionado semántico para las próximas entregas

Usar `MAJOR.MINOR.PATCH` sin prefijo `v` en la versión de aplicación. Elegir el incremento
por el cambio de mayor impacto desde la entrega anterior; reiniciar a cero los componentes
inferiores cuando se incrementa MINOR o MAJOR.

| Incremento | Criterio | Ejemplo hipotético desde `1.1.1` |
| --- | --- | --- |
| PATCH | Corrección compatible de un defecto, presentación o seguridad, sin ampliar contratos ni introducir una funcionalidad nueva | `1.1.2`: corregir un error visual manteniendo el comportamiento contratado |
| MINOR | Nueva funcionalidad compatible y opcional; conserva contratos, datos y flujos existentes | `1.2.0`: añadir una capacidad de consulta compatible |
| MAJOR | Cambio incompatible de API, comportamiento o contrato de integración que exige adaptación o coordinación de consumidores | `2.0.0`: retirar o cambiar de forma incompatible un contrato utilizado |

El número elegido no determina ni autoriza migraciones, cambios de n8n o ventanas: el
alcance real se revisa por separado. Un cambio de seguridad incompatible también puede
requerir MAJOR. Ante duda, el responsable documenta la clasificación antes de aprobar.

Preparar el incremento en un PR de código/versionado **antes** del reporte y la aprobación
finales, nunca editando el checkout productivo para forzar un build. Mantener coherentes
las versiones raíz, API y Web y el fallback `DEFAULT_APP_VERSION` de
[`environment.ts`](../../apps/api/src/config/environment.ts); revisar los metadatos del
lockfile sin introducir actualizaciones de dependencias ajenas al release.
El build productivo toma `APP_VERSION` del paquete raíz y `GIT_COMMIT` de HEAD mediante
el script existente. Los controles actuales no eligen ni hacen cumplir automáticamente SemVer.

Para nuevas publicaciones funcionales, no reutilizar una versión ya asignada a otro
commit funcional publicado o a un tag de aplicación de otro commit. Corregir la versión,
obtener un nuevo SHA y volver a revisar CI/reporte/aprobación. No renumerar entregas
pasadas ni presentar una imagen antigua como si hubiera llevado otra versión.

### Documentación y tooling sin cambios del Hub

- Cambios exclusivos de documentación o tooling de CI/preparación de releases no requieren
  incrementar la versión de aplicación, etiquetar un release del Hub ni reconstruir PROD.
- En el clasificador actual, `.github/` y `scripts/release/` son tooling; `docs/` es
  documentación. Si el delta contra PROD solo contiene esos grupos, corresponde
  `SIN_DESPLIEGUE_HUB`. Un exit `2` del preflight/orquestador significa **no desplegar**,
  no un deployment exitoso ni una invitación a actualizar el SHA de health.
- `scripts/deploy/` y `deploy/` se clasifican como cambios de host, no como tooling inocuo:
  requieren revisión operativa manual. Tampoco justifican por sí solos reconstruir el Hub.
- No aumentar `package.json` solo para estrenar el pipeline o producir diferencias de build.
  La versión debe acompañar una entrega funcional real y su justificación.

## 3. Convención de tags y momento de creación

Para futuras entregas estables del Hub, usar un **tag anotado `vMAJOR.MINOR.PATCH`** dirigido
al SHA completo efectivamente publicado, con fecha, entorno y referencia al expediente
en su descripción. No introducir otra familia de nombres para ocultar una colisión.
Los tags históricos, incluidos `v0.*-pilot.*` y
`release-2026-10-27-hub-pagos-cat`, conservan su significado original; no se renombran.

**Regla de inmutabilidad:** no mover, sobrescribir ni borrar tags existentes. Si el nombre
previsto ya apunta a otro commit, detener la creación y resolver la discrepancia; nunca
forzar su actualización. Si ya apunta al SHA correcto, comprobar la evidencia, sin recrearlo.
Un tag de otra versión sobre el candidato tampoco sustituye la revisión de coherencia.

**Momento propuesto para el tag final:** después del deployment con exit `0`, health y
smoke aprobados, cierre de ventana completado según el runbook y expediente confirmado.
Así el tag final no presenta como publicado algo que solo era candidato. La operación
requiere autorización humana específica y debe apuntar al SHA publicado, aunque `main`
ya haya avanzado por documentación. CI y `prepare-release.yml` no crean tags.
Esta entrega no crea tags ni releases de GitHub, ni añade automatización para ello.

Si el deployment falla o se cancela, registrar el intento y no crear el tag final como
si hubiera sido publicado. Si falla únicamente el trámite de etiquetado posterior,
registrar «tag pendiente»: no repetir un deployment sano solo para obtener un tag.
La publicación de un GitHub Release, si se decide más adelante, es un trámite distinto;
ni su existencia ni un tag prueban el estado actual de PROD después de un rollback.

### Candidato sin tag: WARN no bloqueante

El preflight existente comprueba los tags que apuntan al candidato y advierte si no hay
ninguno; no valida por sí solo la correspondencia SemVer/tag. Bajo la secuencia anterior,
es normal que el candidato aún no tenga su tag final.

1. Resolver el WARN explícitamente en la revisión: «tag final pendiente hasta verificar
   PROD», indicando SHA completo, versión prevista, responsable y expediente.
2. Comprobar que el nombre de tag previsto no esté ocupado por otro SHA y que versión,
   candidato, reporte y CI sean coherentes. Una colisión real no se resuelve aceptando un WARN.
3. El operador puede aprobar ese WARN si no hay otros bloqueos y se cumplen todos los
   criterios GO. No crear anticipadamente un tag solo para suprimir la advertencia.
4. Tras la publicación, decidir/autorizar el tag y registrar su destino o el pendiente.
   No omitir compuertas ni introducir opciones de excepción en el orquestador.

## 4. Del reporte a la aprobación explícita del SHA

La secuencia técnica y sus comandos permanecen en [release-pipeline](release-pipeline.md)
y [deployment-checklist](deployment-checklist.md). Para la decisión de release:

1. El operador obtiene el commit realmente publicado de health en el entorno autorizado;
   no lo sustituye por el último tag o HEAD.
2. Ejecuta manualmente [prepare-release.yml](../../.github/workflows/prepare-release.yml)
   desde `main`, usando ese commit como `deployed_commit`. El candidato es el `GITHUB_SHA`
   de esa ejecución, no una referencia móvil leída después.
3. Conserva el `release-manifest.json` y `release-report.md` aprobados: revisar
   `baselineCommit`, `candidateCommit`, `version`, clasificación, delta y advertencias.
   El workflow verifica la ascendencia de la base, no consulta PROD, ni certifica CI,
   SemVer, tags, aprobación o que las migraciones/workflows estén aplicados.
4. Verifica [CI](../../.github/workflows/ci.yml) **sobre el mismo SHA final de main**, no
   solo sobre la rama del PR. Revisa pruebas y requisitos operativos del checklist.
5. Registra autorización explícita: quién aprueba, fecha, SHA completo, versión, entorno,
   alcance, links de CI/reporte y resolución de WARN. Entrega ese SHA como `ExpectedCommit`
   para el plan y la publicación supervisada. El script no autentica esa aprobación.

Si cambia el candidato después del reporte —incluido un incremento de versión o un merge
posterior—, renovar reporte, revisión de CI y aprobación para el SHA exacto. El orquestador
actual exige candidato == HEAD == origin/main == main remoto accesible para `-Deploy`;
no intentar publicar un SHA anterior forzando el checkout para eludir esa condición.

## 5. Decisión humana GO / NO-GO

| Situación | Decisión |
| --- | --- |
| Cambio real del Hub, SemVer justificado, SHA/reporte/CI coherentes, aprobación registrada, plan/preflight aptos y requisitos operativos del checklist satisfechos | **GO para ejecución supervisada**; todavía no declarar «publicado» |
| Sin tag final, con WARN razonado, nombre libre y demás requisitos satisfechos | Puede ser **GO** documentado; el tag queda pendiente del resultado real |
| Solo docs/tooling o sin cambios Hub/Docker | **NO-GO de deployment del Hub**; registrar que no requiere publicación de contenedores |
| SHA distinto, main sucia/no sincronizada, remoto inaccesible, CI faltante/fallido o reporte/aprobación de otro SHA | **NO-GO** hasta corregir y revalidar |
| Colisión versión/tag para una nueva entrega, versionado incompatible sin coordinar o identidad del commit productivo incierta | **NO-GO** hasta resolver trazabilidad y alcance |
| Delta con database/n8n | **NO-GO por esta ruta supervisada**; seguir el procedimiento específico, sin saltar controles |
| Cambios de host/rutas desconocidas sin revisión operativa resuelta, evidencia/backup/anclas insuficientes, health degradado o cierre requerido no verificado | **NO-GO** hasta resolver según los runbooks y el checklist; la clasificación no es una autorización automática |

GO no automatiza ni reemplaza la confirmación interactiva, la ventana o los postchecks.
Un rollback sigue siendo una decisión y procedimiento manuales del checklist; no cambia
el destino de los tags para aparentar que el código revertido es otra entrega.

## 6. Expediente y avance de main después de publicar

Registrar en [deployments](../deployments/README.md) fecha, entorno, versión declarada y
observada, SHA aprobado y observado, PR funcional, reporte/CI, resultado, cierre de ventana,
smoke, anclas verificadas y si se ejecutó o no recuperación. Actualizaciones documentales
posteriores se identifican con su propio PR/SHA/CI y se separan del commit productivo.
Los digests completos, respaldos, logs y datos sensibles permanecen fuera del repositorio;
la nota pública registra únicamente el resultado no sensible y una referencia al expediente.
Archivar la evidencia aprobada antes de que expire: artifact del candidato 30 días y logs/XML
de CI 14 días actualmente. El JSON local del orquestador es mínimo y best-effort, no sustituye
la autorización ni garantiza por sí solo un expediente completo.

Si `main` avanza por encima de PROD, documentar **ambos SHA y por qué difieren**, clasificar
el delta y dejar explícito «sin deployment» cuando corresponda. No modificar health, la
versión o un tag para hacerlos coincidir. Con cambios funcionales pendientes, preparar un
nuevo candidato; CI verde para `main` no demuestra que ese commit ya esté en ejecución.

## 7. Ejemplo real y límite histórico: piloto de 2026-11-11

Fuente: [expediente del primer deployment](../deployments/2026-11-11-hub-cicd-pilot-prod.md).

| Elemento | Hecho registrado |
| --- | --- |
| PROD anterior | `16153a8` |
| PROD publicado, PR funcional #28 | `de13370f1871e958e5da502deb671a44c68892f7` |
| Health después de la ventana | `PRODUCTION`, `1.1.1`, `de13370`, `status=ok`, `database=connected` |
| Resultado | Exit `0`, Reload/Open correctos, 7/7 verificaciones funcionales aprobadas |
| Recuperación preparada | Anclas `rollback-16153a8` de API/Web verificadas contra los digests previos: 2/2 True; **rollback real no ejecutado** |
| main posterior documental, PR #29 | `c23eeb4`, CI success; no reemplaza `de13370` como commit productivo |
| Tag histórico `v1.1.1` | Resuelve al commit `16153a8a7dda7c5845eae32be5a696f92c71c631`, **no** a `de13370` |

El piloto conservó `1.1.1` aunque cambió el SHA funcional: se registra esta excepción
histórica, no se oculta moviendo `v1.1.1` ni se inventa una versión distinta para el build
publicado. El WARN de candidato sin tag quedó registrado en el preflight del piloto.
La regla prospectiva de versiones únicas no reescribe ese deployment ni su aprobación.

Por tanto, **no crear ahora `v1.1.1` sobre `de13370`**: el nombre ya tiene otro destino.
Tampoco etiquetar ese build como `v1.1.2`, pues no declara esa versión. La próxima entrega
funcional elegirá y aprobará su versión/SHA con esta política; `1.1.2`, `1.2.0` y `2.0.0`
son ejemplos de decisión, no versiones aprobadas, tags creados ni deployments realizados.
Esta Fase 3A/3C solo completa documentación; no exige un nuevo build ni otro deployment.

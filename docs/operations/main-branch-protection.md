# Propuesta de protección de main — Fase 3B

**Estado: propuesta para revisión humana; protección NO activada.**
Diagnóstico de solo lectura del 2026-11-12 para `InternMX/daubert-hub`.
Esta entrega únicamente añade este documento. No cambia configuración remota,
workflows, permisos, dependencias, tags ni releases; no autoriza un deployment.

## 1. Diagnóstico confirmado

| Elemento | Evidencia observada |
| --- | --- |
| Repositorio | Público, no archivado; propietario `InternMX`, tipo `User` (cuenta personal, no organización); rama predeterminada `main` |
| Identidad y permisos de consulta | `InternMX`; API del repositorio devuelve `admin`, `maintain`, `push`, `pull` y `triage` en `true` |
| Colaboradores | `InternMX` con rol `admin` y `KreasDev` con rol `write`. Esto no demuestra que haya dos desarrolladores/revisores disponibles |
| Rama | `GET /branches/main`: `protected: false`; SHA `7cfdc37447543ed2754e78661aefc32bad2bd8c8` |
| Protección clásica | `GET /branches/main/protection`: HTTP 404 con mensaje explícito `Branch not protected`; consistente con el estado de la rama, no un error de autorización observado |
| Rulesets | `GET /rulesets` paginado: `[]`; `GET /rules/branches/main`: `[]` (sin reglas activas aplicables) |
| PR #30 | Integrado el `2026-11-12T20:49:04Z`; commit final igual al SHA de main anterior |
| Checks del PR #30 | `validate` y `release-plan`, ambos `completed/success`, evento `pull_request` |
| Checks del commit final de main | Los mismos dos nombres, ambos `completed/success`, evento `push` |
| Emisor de ambos checks | GitHub App `github-actions`, ID `15368` |
| Métodos de merge habilitados | Merge commit, squash y rebase; esta propuesta no cambia esos settings |
| Plan de la cuenta | `GET /user`, selección `plan.name`: `null`. El plan no quedó disponible en esta consulta; **no se infiere Free ni un plan de pago** |

Evidencia CI consultada:

- [PR #30](https://github.com/InternMX/daubert-hub/pull/30), head
  `b3ebbbb83d0315005eaf91f0500b16444b29098e`.
- [CI del PR](https://github.com/InternMX/daubert-hub/actions/runs/43302568651).
- [CI del commit final de main](https://github.com/InternMX/daubert-hub/actions/runs/43304047446).

Las consultas de protección, reglas y colaboradores fueron accesibles. No se obtuvo
el plan de facturación ni se comprobó en la interfaz la capacidad efectiva de guardar
reglas. No se probó ninguna operación de escritura para demostrar permisos.
El diagnóstico es una fotografía: repetirlo antes de activar, especialmente mientras
se desarrolla la Fase 3D en paralelo.

### Análisis del pipeline y la política

- [`ci.yml`](../../.github/workflows/ci.yml) ejecuta `CI` en PR hacia `main` y en
  push a `main`, sin filtros por rutas. Sus únicos jobs son `validate` y
  `release-plan`, sin `name` alternativo, matriz ni condiciones que los omitan.
  No hay colisión con nombres de jobs del otro workflow actual.
- `validate` instala con `npm ci --ignore-scripts`, ejecuta typecheck, lint, build,
  dev guard, clasificador y pruebas de API/Web; usa valores ficticios de DB.
  `release-plan` ejecuta Pester 3.4.0 en Windows PowerShell 5.1 con operaciones
  simuladas. El YAML no ejecuta despliegues, Docker ni migraciones.
- Ambos jobs tienen timeout, checkout sin credenciales persistidas y permisos
  `contents: read`; CI cancela ejecuciones anteriores de la misma referencia.
  Se exige el resultado del SHA vigente, no el verde de un commit anterior.
- [`prepare-release.yml`](../../.github/workflows/prepare-release.yml) es manual
  (`workflow_dispatch`), solo ejecuta `report` en `refs/heads/main`, recibe
  `deployed_commit` y genera artefactos informativos. **No exigir `report` ni el
  nombre del workflow como check de PR**: no se producen automáticamente en PR.
- Los contextos requeridos son exactamente **`validate`** y **`release-plan`**,
  confirmados por API en PR y main. No escribir `CI`, `CI / validate` ni el
  nombre de un paso como contexto, aunque la interfaz agrupe jobs bajo `CI`.
- La [política de releases](release-policy.md) exige CI sobre el mismo SHA final
  de `main`, reporte y autorización humana del candidato. La protección previa
  al merge complementa esa comprobación; no la sustituye ni demuestra que el
  SHA esté publicado. El deployment continúa manual y supervisado desde el
  servidor autorizado según el [checklist](deployment-checklist.md).

## 2. Configuración propuesta

**Recomendación: una regla clásica de branch protection para el patrón exacto
`main`.** Resuelve el alcance con una sola regla y permite PR sin aprobación
externa obligatoria. No crear además un ruleset equivalente: las restricciones
se acumulan y complican el diagnóstico.

| Opción de GitHub | Valor propuesto | Motivo |
| --- | --- | --- |
| Branch name pattern | `main`, sin comodines | No afectar ramas de trabajo ni la Fase 3D |
| Require a pull request before merging | Activado | Integración por PR, también para el administrador |
| Require approvals | Desactivado: cero aprobaciones obligatorias | Un desarrollador puede integrar su propio PR con CI; GitHub no permite autoaprobarlo |
| Require review from Code Owners | Desactivado | No introducir un segundo aprobador implícito |
| Require approval of the most recent reviewable push | Desactivado | Evitar bloqueo por ausencia de otra persona |
| Dismiss stale approvals / restricciones de descarte | Desactivado | Sin política de aprobaciones obligatorias en esta fase |
| Require status checks to pass before merging | Activado | Exigir los dos jobs |
| Checks | `validate` y `release-plan`, origen **GitHub Actions** para ambos | Usar los contextos reales y limitar su emisor; ID observado `15368` |
| Require branches to be up to date before merging | Activado (strict) | Revalidar con la main actual, importante con trabajo paralelo |
| Do not allow bypassing the above settings | Activado | Incluir administradores y roles con bypass de branch protection |
| Excepciones/bypass de PR | Ninguna | Tampoco para bots, Apps o el propietario |
| Allow force pushes | Desactivado | Prohibir reescritura de main |
| Allow deletions | Desactivado | Prohibir eliminación de main |
| Lock branch / restricción adicional de pushes | Desactivado / sin configurar | Mantener merges legítimos operables; no convertir main en solo lectura |
| Signed commits, linear history, merge queue, deployments requeridos | Desactivados | No son requisitos de esta fase; deployments previos al merge invertirían el flujo manual actual |
| Require conversation resolution | Desactivado en esta propuesta mínima | La revisión y resolución de comentarios sigue siendo humana |

No exigir aprobación no elimina la revisión humana del cambio ni la autorización
separada para publicar. No usar bypass como sustituto de resolver CI fallido.
El administrador conserva la capacidad de **editar la configuración**, aunque
no pueda saltarse la regla al integrar; esa es la vía de recuperación.

### Aplicabilidad y verificaciones pendientes

- GitHub ofrece protección clásica y branch/tag rulesets en repositorios públicos
  con GitHub Free; para repositorios privados se requiere un plan compatible
  (Pro para cuenta personal; Team/Enterprise según propietario). Por ser público,
  el plan no es un impedimento esperado para esta propuesta básica. Verificar
  disponibilidad real en Settings antes de guardar y reevaluar si cambia la
  visibilidad o el propietario.
- El rol `admin` está confirmado, pero la sesión/token puede tener restricciones
  adicionales de escritura. Si la interfaz o API devuelve 403/404/422, registrar
  mensaje y estado, detener activación y verificar rol, alcance del acceso y plan;
  no interpretar cualquier 404 como ausencia de protección.
- La facturación debe verificarse manualmente por el propietario en los ajustes
  de su cuenta. No se necesitan tokens nuevos ni exponer credenciales para esta
  propuesta. No se consultaron secretos ni se requiere documentarlos.
- No basar este diseño en equipos, reglas organizacionales o listas de bypass
  clásicas por actor: el propietario actual es una cuenta personal. Algunas
  capacidades de organización/Enterprise y de evaluación de reglas dependen del
  plan; no se presuponen disponibles.
- Si se elige Rulesets en una revisión posterior, traducir el mismo alcance a un
  **branch ruleset**: incluir solo `refs/heads/main`, sin exclusiones ni bypasses,
  PR con cero aprobaciones, los dos checks estrictos y emisor GitHub Actions,
  `Restrict deletions` y `Block force pushes`. No activar `Restrict updates`
  (bloquearía los merges sin bypass), ni usar push/tag rulesets. Requiere revisar
  el formulario y aprobar ese cambio de mecanismo; la ruta operativa de abajo
  corresponde únicamente a la protección clásica.

## 3. Repetir diagnóstico (solo lectura)

Desde una sesión autenticada de GitHub CLI, ejecutar individualmente:

```powershell
gh api user --jq '{login,plan:.plan.name}'
gh api repos/InternMX/daubert-hub --jq '{visibility,default_branch,permissions,owner_type:.owner.type}'
gh api repos/InternMX/daubert-hub/collaborators --paginate --jq '.[] | {login,role_name}'
gh api repos/InternMX/daubert-hub/branches/main
gh api repos/InternMX/daubert-hub/branches/main/protection
gh api repos/InternMX/daubert-hub/rulesets --paginate
gh api repos/InternMX/daubert-hub/rules/branches/main
gh api repos/InternMX/daubert-hub/commits/main/check-runs --jq '{total_count,checks:[.check_runs[]|{name,status,conclusion,head_sha,app:{id:.app.id,slug:.app.slug}}]}'
```

Si hay rulesets, consultar también cada ID con
`gh api repos/InternMX/daubert-hub/rulesets/ID` para ver condiciones, enforcement y
bypasses, incluidos los desactivados. Guardar respuestas y capturas sin información
sensible en el expediente de activación. Si aparecieron reglas nuevas, reconciliar
con su responsable antes de continuar, sin sobrescribir su trabajo.

## 4. Pruebas sin cambios productivos

**No ejecutadas en esta entrega.** No demostrar prohibiciones intentando escribir,
forzar o borrar `main` real, ni con `--dry-run`: no es prueba fiable del control
remoto. Las escrituras de ensayo requieren autorización futura y un repositorio
de pruebas independiente, sin secretos, entornos, webhooks ni acceso al servidor.
No usar ni modificar el worktree de otro agente.

### Ensayo aislado previo a la activación

1. Preparar un repositorio de pruebas público bajo cuenta personal, misma rama
   predeterminada y snapshot del código revisado, sin integraciones productivas.
   Revisar sus workflows antes de habilitar Actions. Usar su propia interfaz o
   checkout de pruebas autorizado, nunca el checkout productivo. Mantener intactos
   los workflows de este repositorio de origen.
2. Ejecutar CI en ese repositorio mediante un PR documental a su `main`; confirmar
   los mismos nombres y el emisor local de los checks. Si se usan checks sintéticos,
   solo prueban las reglas, no la compatibilidad del pipeline real.
3. Configurar allí la regla de la sección 2 y registrar el SHA inicial. Usar una
   cuenta administradora sin bypass; probar también con rol write si está disponible.
4. Aplicar la matriz siguiente. Cada intento debe apuntar explícitamente al remoto
   **de pruebas**. En los rechazos, registrar mensaje y verificar que el SHA no cambió.

| Caso aislado | Acción de ensayo | Resultado esperado |
| --- | --- | --- |
| Push directo | Crear un commit documental nuevo e intentar enviarlo a main de pruebas sin PR | Rechazo por PR obligatorio, también con admin |
| CI pendiente | Abrir PR documental y consultar su panel de merge antes de completar CI | Merge bloqueado por los checks pendientes |
| CI fallido | En rama de PR de pruebas, introducir deliberadamente un error de typecheck; en otro ensayo romper una expectativa Pester | En cada caso, el check respectivo falla y merge queda bloqueado; nunca integrar esos commits |
| CI recuperado | Revertir los errores dentro de la rama del PR y esperar ambos checks del nuevo SHA | Merge permitido con cero aprobaciones obligatorias y sin bypass |
| Base desactualizada | Mantener un PR verde abierto e integrar otro PR documental en main de pruebas | El primero exige actualizar base y completar nuevamente CI |
| Force push | Intentar retroceder main de pruebas a su padre mediante push forzado | Rechazo; verificar prohibición específica de force push en configuración, aunque el rechazo pueda mencionar también PR/checks |
| Eliminación | Intentar borrar main de pruebas | Rechazo; borrar la rama predeterminada también tiene restricciones propias, por lo que este resultado por sí solo no demuestra la regla de eliminación |
| Ruta legítima | Integrar solo un PR documental verde en main de pruebas | Merge normal permitido; CI posterior al merge se ejecuta, sin deployment |

Para aislar las prohibiciones de force push y borrado, se puede crear en el
repositorio de pruebas una rama no predeterminada `protection-probe`, copiar la
regla con patrón exacto de esa rama y ensayar primero solo las prohibiciones de
reescritura/borrado (sin PR/checks), y después la configuración completa. Así no se
atribuye el rechazo a otra regla. La regla completa exige checks que el CI actual
no dispara para esa base: esa variante no sirve para probar el merge positivo.
Conservar evidencia y limpiar únicamente los recursos de pruebas autorizados.

### Validación en el repositorio real tras autorización

- Leer de nuevo la protección: patrón exacto, checks y emisor, modo estricto,
  aplicación a admin, `allow_force_pushes.enabled: false` y
  `allow_deletions.enabled: false`. Confirmar `protected: true`.
- Abrir, con autorización separada, un PR exclusivamente documental hacia main;
  comprobar los requisitos en el panel sin pulsar merge, sin auto-merge y sin
  introducir errores. Revisar ambos checks sobre su último SHA y origen esperado.
- El PR debe quedar integrable sin aprobación externa cuando CI esté verde y la
  base actualizada. Puede cerrarse sin merge. Un merge de prueba real no es necesario;
  el siguiente merge legítimo autorizado validará la ruta positiva y su CI final.
- No ejecutar `prepare-release`, publicar artefactos productivos ni desplegar para
  probar protección. El ensayo aislado aporta los rechazos destructivos; la lectura
  de reglas y el PR real aportan verificación de configuración y compatibilidad.

## 5. Activación exacta (solo cuando se autorice)

1. Registrar responsable, fecha, autorización, enlace a esta propuesta y resultado
   del ensayo. Coordinar una pausa de merges con el responsable de Fase 3D y revisar
   sus PR pendientes. No hay que detener producción ni tocar el servidor.
2. Repetir sección 3 y archivar el estado anterior. Si sigue sin protección, dejar
   constancia de ello; si cambió, parar y revisar la nueva configuración. Confirmar
   acceso administrativo a Settings y recuperación de la cuenta antes de activar.
3. Abrir `https://github.com/InternMX/daubert-hub/settings/branches` →
   **Branch protection rules → Add classic branch protection rule**.
4. En **Branch name pattern**, escribir exactamente `main`.
5. Marcar **Require a pull request before merging**. Dejar **Require approvals**,
   Code Owners y aprobación del último push desmarcados. No agregar excepciones.
6. Marcar **Require status checks to pass before merging** y
   **Require branches to be up to date before merging**. Buscar y añadir
   `validate` y `release-plan`. Seleccionar **GitHub Actions** como fuente de cada
   uno, no **Any source**. Verificar que ambos quedaron agregados.
   Si no aparecen, detenerse y obtener una ejecución reciente de CI mediante un
   PR autorizado; no inventar contextos ni exigir el workflow manual.
7. Marcar **Do not allow bypassing the above settings**. Dejar **Allow force
   pushes** y **Allow deletions** desmarcados. Mantener las demás opciones como
   indica la tabla; no bloquear la rama ni exigir deployments o merge queue.
8. Revisar todo el formulario y el objetivo `main` antes de **Create**. Guardar
   activa la regla inmediatamente; esta acción requiere la autorización indicada.
   No crear simultáneamente un ruleset.
9. Ejecutar la validación real de la sección 4. En la API clásica se esperan
   `enforce_admins.enabled: true`, `required_status_checks.strict: true`, checks
   con `context` correcto y `app_id: 15368`, y
   `required_pull_request_reviews.required_approving_review_count: 0`.
   La presencia de ese objeto de PR con cero aprobaciones conserva el PR obligatorio.
   Revisar también que Code Owners y aprobación del último push sean falsos.
10. Registrar URL/capturas de la regla, JSON observado, PR de validación y resultados.
    Comunicar la activación a quienes integran cambios. Con esto termina la
    operación; cualquier merge o deployment requiere su procedimiento habitual.

## 6. Recuperación de una configuración incorrecta

Un bloqueo de merge por sí solo no exige rollback de la aplicación. No tocar
PROD, tags, historial de main ni los mecanismos de rollback de Fase 3D.

1. Pausar merges y registrar el síntoma, PR/SHA, checks y configuración actual.
   Distinguir fallo genuino de CI de nombre/emisor incorrecto, base desactualizada,
   revisión obligatoria accidental o reglas superpuestas. Cancelación/cola de
   runners se resuelve esperando o reejecutando CI autorizado, no quitando checks.
2. Con el administrador autorizado, abrir **Settings → Branches → regla main →
   Edit** y corregir únicamente el campo erróneo según sección 2; **Save changes**.
   Un requisito accidental de una aprobación se corrige desactivando **Require
   approvals**, manteniendo **Require a pull request before merging**.
3. Repetir lecturas y validación del PR. Conservar bloqueo de force push/borrado,
   PR obligatorio e inclusión de administradores; no añadir bypass permanente.
4. Si no puede repararse y el responsable autoriza retirar la regla nueva, exportar
   evidencia, mantener pausa de merges y usar **Settings → Branches → regla main →
   Delete**. Esto devuelve el estado observado inicialmente **sin protección**,
   no una configuración segura definitiva. Si existía configuración anterior al
   activar, restaurarla del expediente en vez de borrarla indiscriminadamente.
5. No aceptar pushes durante ese intervalo. Corregir y ensayar la propuesta,
   reactivar la protección, validar y cerrar el incidente con hora y responsable.
   Si en una revisión futura se usara Rulesets, desactivar solo el ruleset creado
   por esta operación; eso no elimina otras reglas aplicables.
6. Si se perdió acceso administrativo, recurrir al propietario/recuperación de
   cuenta o soporte de GitHub. No existe una solución mediante un push local y
   este documento no presupone un segundo administrador disponible.

## 7. Riesgos y límites

- Hasta la activación autorizada, main sigue sin protección. El commit documental
  no aplica controles en GitHub.
- Cero aprobaciones permite operar a una sola persona, pero no garantiza revisión
  independiente. Los colaboradores con escritura pueden proponer cambios a CI;
  asociar el check a GitHub Actions no fija el contenido del workflow ni impide
  que otro workflow de la misma App reutilice el nombre. Revisar cambios de CI y
  mantener nombres únicos; una política de revisores independientes sería una
  decisión posterior cuando exista personal disponible.
- GitHub acepta ciertos checks `neutral` o `skipped` como satisfechos. Los jobs
  actuales no tienen condiciones de omisión, pero la regla no garantiza por sí
  sola que todas las pruebas sigan ejecutándose si se modifica el workflow.
- El modo estricto puede exigir actualizar ramas y repetir CI al avanzar main.
  Consumo/cuotas de Actions, caída de GitHub, runners Windows o checks renombrados
  pueden bloquear merges. No habilitar merge queue sin adaptar sus eventos de CI.
- Proteger main no protege tags, otras ramas, secretos, la cuenta administradora
  ni el servidor, y no sustituye backups o el procedimiento de recuperación.
  El administrador puede cambiar las reglas: no es una barrera ante el compromiso
  de esa cuenta. Sin acceso de emergencia a la cuenta puede haber demora operativa.
- La aplicación al admin y la compatibilidad del formulario requieren validación
  posterior; las consultas de lectura no prueban rechazos reales. No se realizaron
  ensayos de escritura ni se verificó manualmente el plan de facturación.

## 8. Referencias

Documentación oficial consultada el 2026-11-12; confirmar disponibilidad y etiquetas
de la interfaz al activar:

- [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- [Managing a branch protection rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule).
- [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets).
- [Creating rulesets for a repository](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository).

# Daubert Hub — Primer despliegue supervisado CI/CD (2026-11-11)



**Estado:** Despliegue exitoso, validación funcional aprobada y verificación independiente de ambas anclas completada (2/2). Rollback real no ejecutado.



## Información del release



| Concepto | Valor |
|---|---|
| Fecha | 11 de noviembre de 2026 |
| Entorno | PRODUCTION |
| Versión | 1.1.1 |
| Commit anterior | `16153a8` |
| Commit desplegado | `de13370f1871e958e5da502deb671a44c68892f7` |
| Pull Request funcional | [#28](https://github.com/InternMX/daubert-hub/pull/28) |
| Pull Request documental | [#29](https://github.com/InternMX/daubert-hub/pull/29), integrado en `c23eeb4` |
| Método | `Invoke-DaubertRelease.ps1 -Deploy -RequireClosedWindow` |
| Resultado | Código 0 — DEPLOYMENT CORRECTO |



## Validaciones previas



- CI de GitHub Actions aprobado.

- Repositorio limpio y sincronizado con `origin/main`.

- Preflight: 38 PASS, 1 WARN y 0 FAIL.

- Advertencia no bloqueante: candidato sin tag de release.

- Respaldos PostgreSQL verificados mediante SHA-256.

- Respaldo n8n OnChange del 11/11/2026 verificado.

- Evidencia de las imágenes anteriores registrada fuera del repositorio.

- Sin migraciones PostgreSQL ni cambios en workflows n8n.



## Despliegue



1. Se activó el cierre de entradas de Nginx y se verificó `CLOSURE ACTIVE`.

2. Se ejecutó el plan con `-RequireClosedWindow`, resultado APTO.

3. Se ejecutó el despliegue supervisado y se confirmó mediante `DEPLOY DAUBERT HUB`.

4. El orquestador reportó `DEPLOYMENT CORRECTO`, código 0.

5. Se ejecutaron `Reload` y `Open`, ambos correctamente.



## Validaciones posteriores



La API confirmó:



- Estado: `ok`.

- Entorno: `PRODUCTION`.

- Versión: `1.1.1`.

- Commit: `de13370`.

- PostgreSQL: `connected`.



El operador confirmó satisfactoriamente **7/7 verificaciones funcionales** del Hub, incluyendo autenticación, navegación, automatizaciones, información del sistema y disponibilidad de n8n.



No se ejecutaron reprocesos ni se enviaron notificaciones como parte del smoke test.



## Recuperación



Las imágenes anteriores corresponden al commit `16153a8`.



Anclas verificadas independientemente contra los digests SHA-256 del expediente predeploy:



- `daubert-hub-api:rollback-16153a8`: coincidencia por digest **True**.

- `daubert-hub-web:rollback-16153a8`: coincidencia por digest **True**.



Expediente previo: `%LOCALAPPDATA%\DaubertHub\releases\predeploy-20261111-160852.json`.



**Resultado: 2/2 True.** Ambas anclas apuntan exactamente a las imágenes anteriores del Hub, correspondientes a `16153a8`. Los valores completos de los digests y la evidencia original permanecen fuera del repositorio; aquí se registra únicamente el resultado confirmado del cierre operativo.



**No se ejecutó rollback real en producción.** La existencia de las anclas y su coincidencia por digest no constituyen una prueba de restauración ni demuestran que se recrearon contenedores con esas imágenes.

## Cierre documental y CI posterior (Fase 3A)

El [PR #29](https://github.com/InternMX/daubert-hub/pull/29) incorporó esta nota y su entrada en el índice. El workflow [CI](../../.github/workflows/ci.yml) del commit documental [`c23eeb4`](https://github.com/InternMX/daubert-hub/commit/c23eeb45109a3bab882a312493ce24e2509daec8) terminó en **success**.

Ese commit solo añadió documentación: no se desplegó por ese motivo. El commit publicado de este expediente sigue siendo `de13370f1871e958e5da502deb671a44c68892f7` (`de13370` en health), con versión `1.1.1`. CI correcto para un commit posterior no implica que ese commit esté en PROD.

Esta actualización documental incorpora la comprobación de anclas y el estado de CI confirmados por el operador; no reejecuta verificaciones en PROD, backups, despliegues ni pruebas de recuperación. Procedimiento operativo: [deployment-checklist](../operations/deployment-checklist.md). Identificación y versionado: [release-policy](../operations/release-policy.md).



## Pendientes de mejora



- Investigar las dos ejecuciones omitidas del respaldo semanal de n8n.

- Proteger la rama `main` con políticas de revisión y CI obligatorio.

- Convención de tags y versionado documentada en [release-policy](../operations/release-policy.md) (Fase 3C). Su aplicación y la creación de tags futuros requieren decisión humana; no se creó ni movió ningún tag en este cierre.

- Continuar validando los procedimientos de recuperación en un entorno aislado.

- Documentar la discrepancia observada en una ejecución inicial del plan con ventana abierta.



## Conclusión



El primer piloto CI/CD de Daubert Hub demostró que es posible publicar una versión en producción mediante un proceso supervisado, con validaciones previas, protección de las entradas operativas, evidencia de recuperación y verificaciones técnicas y funcionales posteriores.



**Resultado:** despliegue y validación funcional completados satisfactoriamente.



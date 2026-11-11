\# Daubert Hub — Primer despliegue supervisado CI/CD (2026-11-11)



\*\*Estado:\*\* Despliegue exitoso y validación funcional aprobada.



\## Información del release



| Concepto | Valor |

|---|---|

| Fecha | 11 de noviembre de 2026 |

| Entorno | PRODUCTION |

| Versión | 1.1.1 |

| Commit anterior | `16153a8` |

| Commit desplegado | `de13370f1871e958e5da502deb671a44c68892f7` |

| Pull Request funcional | #28 |

| Método | `Invoke-DaubertRelease.ps1 -Deploy -RequireClosedWindow` |

| Resultado | Código 0 — DEPLOYMENT CORRECTO |



\## Validaciones previas



\- CI de GitHub Actions aprobado.

\- Repositorio limpio y sincronizado con `origin/main`.

\- Preflight: 38 PASS, 1 WARN y 0 FAIL.

\- Advertencia no bloqueante: candidato sin tag de release.

\- Respaldos PostgreSQL verificados mediante SHA-256.

\- Respaldo n8n OnChange del 11/11/2026 verificado.

\- Evidencia de las imágenes anteriores registrada fuera del repositorio.

\- Sin migraciones PostgreSQL ni cambios en workflows n8n.



\## Despliegue



1\. Se activó el cierre de entradas de Nginx y se verificó `CLOSURE ACTIVE`.

2\. Se ejecutó el plan con `-RequireClosedWindow`, resultado APTO.

3\. Se ejecutó el despliegue supervisado y se confirmó mediante `DEPLOY DAUBERT HUB`.

4\. El orquestador reportó `DEPLOYMENT CORRECTO`, código 0.

5\. Se ejecutaron `Reload` y `Open`, ambos correctamente.



\## Validaciones posteriores



La API confirmó:



\- Estado: `ok`.

\- Entorno: `PRODUCTION`.

\- Versión: `1.1.1`.

\- Commit: `de13370`.

\- PostgreSQL: `connected`.



El operador confirmó satisfactoriamente las siete verificaciones funcionales del Hub, incluyendo autenticación, navegación, automatizaciones, información del sistema y disponibilidad de n8n.



No se ejecutaron reprocesos ni se enviaron notificaciones como parte del smoke test.



\## Recuperación



Las imágenes anteriores corresponden al commit `16153a8`.



Anclas previstas:



\- `daubert-hub-api:rollback-16153a8`

\- `daubert-hub-web:rollback-16153a8`



Expediente previo: `%LOCALAPPDATA%\\DaubertHub\\releases\\predeploy-20261111-160852.json`.



\*\*Pendiente:\*\* anexar el resultado de la comprobación independiente de los digests de ambas anclas.



No se ejecutó rollback real en producción.



\## Pendientes de mejora



\- Investigar las dos ejecuciones omitidas del respaldo semanal de n8n.

\- Proteger la rama `main` con políticas de revisión y CI obligatorio.

\- Establecer una convención de tags y versionado.

\- Continuar validando los procedimientos de recuperación en un entorno aislado.

\- Documentar la discrepancia observada en una ejecución inicial del plan con ventana abierta.



\## Conclusión



El primer piloto CI/CD de Daubert Hub demostró que es posible publicar una versión en producción mediante un proceso supervisado, con validaciones previas, protección de las entradas operativas, evidencia de recuperación y verificaciones técnicas y funcionales posteriores.



\*\*Resultado:\*\* despliegue y validación funcional completados satisfactoriamente.


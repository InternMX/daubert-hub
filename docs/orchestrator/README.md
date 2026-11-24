# Daubert Hub Update Orchestrator

Sistema independiente del Hub para preparar, planificar, autorizar, ejecutar, verificar, recuperar y documentar releases. **Estado: diseño aprobado conceptualmente (2026-11-24); sin implementar.**

| Documento | Contenido |
|---|---|
| [ADR-006](../decisions/ADR-006-update-orchestrator-arquitectura.md) | Decisiones DF-01…DF-15, precisiones P-A/P-B/P-C, garantías y límites del journal |
| [capabilities-and-gates.md](capabilities-and-gates.md) | Escalera V0–VX, restricciones del host compartido, clases C0–C4, modos, compuertas, registro de compuertas |
| [risk-register.md](risk-register.md) | Riesgos aceptables RA, restricciones bloqueantes NB, riesgos operativos OR |
| [remediation-or1-or2.md](remediation-or1-or2.md) | Planes para la identidad age y la dependencia del inicio de sesión |
| [increment-0.md](increment-0.md) | Alcance, orden y criterios de salida del incremento 0 |
| [j1-journal-test-plan.md](j1-journal-test-plan.md) | PoC del journal: diseño, pruebas P1–P14 y criterios |

## Roadmap

| Inc. | Contenido | Niveles | Resultado |
|---|---|---|---|
| **0** | Documentación, J1, 7 PR de las herramientas actuales, OR-1/OR-2, clon operativo, `daubert-ai` M0–M3 | V0, V1 | Fundamentos y riesgos actuales tratados |
| **1 · MVP Observar** | C0 completo | V0, V1, V3 → V4 | Plan y estado reales de PROD en solo lectura |
| **2 · Modo guiado** | Intents declarados, poscondiciones, evidencias, `resume`/`recover`; `hub-release` completo en guiado | V0, V1, V3 | **V1-útil** |
| **3 · Ejecutor y sandbox** | Adaptadores, aprobaciones por paso, huella de PROD, sandbox V2; C1/C2 supervisados en TEST | V0–V3 | Ejecución real probada con cortes |
| **4 · C3 en TEST, C2 en PROD** | Cierre, Deploy, Switch supervisados en TEST; R0/R1 en TEST; G-C2 tras OR-1 | V3, V5 (solo C2) | Respaldo y verificación automatizados en PROD |
| **5 · G-C3** | Evidencia completa, OR-4 en M4, auditoría de Codex, GO del operador | V5 | Release productiva supervisada |
| **6+** | Doble aprobación, C4 con laboratorio o ADR, laboratorio externo, servidor dedicado | VX | Evolución |

## Condiciones de V1-útil (fin del incremento 2, sin laboratorio)

1. J1 superada y RA-1 aceptado.
2. AC1–AC9 del MVP superados (incluida la demostración en V3 y V4 de cero eventos Docker y ninguna escritura en raíces gestionadas).
3. Ensayo guiado completo de `hub-release` en TEST con el orquestador terminado al menos una vez en cada frontera de intent; reanudación correcta y drift nulo.
4. Expediente generado equivalente al de v1.3.0, sin secretos (canarios a cero), con `MANIFEST` y cadena de hashes verificables.
5. La reproducción de v1.3.0 en el plan detecta B8 (Web sin healthcheck) y N4 (herramientas sin el PR #45).
6. Prueba negativa: el motor rechaza ejecutar en supervisado cualquier paso C2 o C3 en PROD.
7. Planes OR-1 y OR-2 aprobados; OR-1 ejecutado antes de G-C2.

### Criterios de aceptación del MVP (AC1–AC9)

| AC | Criterio |
|---|---|
| AC1 | Garantía de solo lectura: prueba de arquitectura, lista blanca de comandos, cero eventos Docker, hashes y refs sin cambios |
| AC2 | Snapshot exacto, con regresión de B8 |
| AC3 | Rechazo `ENV_MISMATCH` |
| AC4 | Matriz de fallos y propiedades del journal (J1) |
| AC5 | Plan determinista y ligado (hash) |
| AC6 | Canarios de secretos a cero |
| AC7 | Portabilidad desde `%ProgramFiles%` con Node propio; ninguna ruta `C:\Users\` |
| AC8 | Reproducción de v1.3.0 |
| AC9 | `status` de PROD en solo lectura tras revisión de Codex, con cero eventos Docker |

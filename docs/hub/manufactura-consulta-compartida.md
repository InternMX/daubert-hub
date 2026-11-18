# Consulta compartida de borradores de Hojas de Manufactura

Solo TEST. Requiere la migración 105 (propuesta, **no aplicada** a `daubert_hub_test`; ver `database/migrations/daubert_hub_test/README-105.md`).

## Reglas
| Quién | Borrador / finalización en curso ajena | Descartada ajena |
|---|---|---|
| Propietario | edita, autoguarda, finaliza, descarta (sin cambios) | la ve |
| GENERAL (otra cuenta) | **consulta en solo lectura** | no la ve (404) |
| ADMIN | consulta; edita/finaliza/descarta solo tras **«Editar como administrador»** (permisos de servidor sin cambios) | la ve |
| Revisor asignado | consulta; conserva «Registrar mi revisión» (no modifica datos técnicos) | la ve |

## Defensa en capas
1. **Base de datos (105):** solo cambia la lectura (`pol_revisiones_sel`); escritura, triggers y privilegios intactos. El PDF de una revisión no finalizada (`pdfs`, `pdf_contenidos`) conserva su exposición (creador, revisor asignado, ADMIN). Las imágenes de firma siguen protegidas por la RLS de `firmas`.
2. **API:** toda escritura exige creador o ADMIN (403 para el resto). `GET open` = mis borradores; `GET team[?codigo=]` = borradores y finalizaciones en curso de otras cuentas (el servidor separa propios/equipo, sin duplicados). `GET history?codigo=` lista lo consultable del código. La vista incluye `propietario` y `permisos`. Consultar nunca escribe (se comprueba versión, fecha, huella, actor y auditoría).
3. **Interfaz:** «Mis hojas» = Mis borradores · Borradores del equipo (chip «Solo lectura») · Hojas finalizadas (sin repetir borradores). Un borrador ajeno se abre con el chip «Solo lectura», el aviso «Estás consultando el borrador de …», formulario deshabilitado, **sin** autoguardado, guardar, finalizar, descartar ni responsables editables. Una finalización en curso ajena indica que el PDF todavía no es definitivo. Para un ADMIN aparece «Editar como administrador» (válido solo para ese documento; abrirlo no guarda).
4. **Actividad reciente:** muestra la creación de borradores ajenos y FINALIZANDO/FINALIZADA (nunca descartadas ni autoguardados); el enlace abre la revisión en el modo permitido.

## Pruebas
- Instancia desechable (101–105): `apps/api/test/desechable/18-consulta-compartida.desechable.spec.ts` (dos GENERAL, ADMIN, propio/ajeno, revisor asignado, finalizada, descartada, finalización en curso con PDF generado, firmas privadas, SQL directo, listas, Actividad, consulta que no modifica) más los ajustes de 01–04 y 15; smoke SQL 15/15.
- Web: `DocumentPanel.test.tsx` (secciones, solo lectura, FINALIZANDO ajeno, «Editar como administrador»), `ManufacturingDocuments.integration.test.tsx` (9 y 9b: sin autoguardado ni creación).

## Riesgos / decisiones registradas
- Un revisor asignado seguía viendo borradores descartados (101); se conserva (no se endurece).
- Sin la 105 la API nueva funciona: la base sigue ocultando los borradores ajenos y «Borradores del equipo» muestra solo lo que la base permita.
- Crear un borrador sobre un código ya existente sigue respondiendo 409 uniforme sin ids; el borrador ajeno se encuentra en «Borradores del equipo» o en «Hojas de este código».

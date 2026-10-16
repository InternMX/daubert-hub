# Consulta de productos de BIND ERP (fase 2 de manufactura)

Cliente HTTP **de solo lectura** + servicio + endpoints para buscar un producto de BIND por código DCMX o por ID, interpretarlo con `interpretarProductoBind` (fase 1) y
devolver los datos originales, lo interpretado, los pendientes y las advertencias. **No guarda nada en PostgreSQL** (no importa módulos de base de datos), no genera
documentos y no confirma ninguna especificación.

## Arquitectura
| Archivo | Responsabilidad |
|---|---|
| `bind/bind-erp.client.ts` | Único punto que habla con `https://api.bind.com.mx`: construye el `$filter`, envía `Authorization: Bearer` (y `Ocp-Apim-Subscription-Key` si existe), timeout por solicitud y total, reintentos limitados, validación de la respuesta y de `nextLink`. Devuelve resultados tipados (nunca mensajes, URLs ni cuerpos de BIND). |
| `bind/bind-products.service.ts` | Valida la entrada, llama al cliente, traduce los resultados a respuestas HTTP propias del Hub e invoca `interpretarProductoBind` / `sugerirDatosPlantilla`. |
| `bind/bind-products.controller.ts` | Rutas autenticadas por los guards globales (no `@Public`). |
| `manufacturing-sheets.module.ts` | Registrado en `AppModule`. |
| `src/config/environment.ts` | Variables `BIND_*` (opcionales). |
| `scripts/bind-product-smoke.ts` | Prueba real manual (`npm run bind:smoke`). |

## Variables de entorno (solo en el backend; nunca en logs, respuestas, frontend ni repositorio)
| Variable | Descripción |
|---|---|
| `BIND_API_KEY` | API Key de BIND (Perfil de usuario → Integraciones). Sin ella la consulta responde 503 `BIND_NOT_CONFIGURED`; no bloquea el arranque. |
| `BIND_SUBSCRIPTION_KEY` | Clave de suscripción del portal de desarrolladores («Mi cuenta»). Opcional; si existe se envía como `Ocp-Apim-Subscription-Key`. |
| `BIND_API_BASE_URL` | Opcional. Por defecto `https://api.bind.com.mx`. Debe ser HTTPS, host `*.bind.com.mx`, sin credenciales ni puerto. |

Ejemplos con nombres vacíos en `apps/api/.env.example`. El contenedor de producción solo recibe las variables listadas en `compose.pilot.yaml`: **antes de usar esta función en
el piloto hay que añadir `BIND_API_KEY` (y `BIND_SUBSCRIPTION_KEY`) a la configuración del servicio `api`** (decisión pendiente; no se modificó el despliegue).

## Endpoints
`GET /api/manufacturing-sheets/bind-products/by-code/:code` y `GET /api/manufacturing-sheets/bind-products/by-id/:id` (sesión autenticada, ADMIN o GENERAL).
- `code`: 1–64 caracteres entre letras, dígitos, `.`, `-` y `_`. `id`: GUID.
- Filtros enviados a BIND (exactos): `$filter=Code eq 'SCHFPMG001'` y `$filter=ID eq guid'bbe2cc0c-3498-47cb-a556-d435eba5c0b4'` (esta última es la sintaxis documentada).
- Nunca se descarga el catálogo. `nextLink` solo se sigue si permanece en el host de BIND, por HTTPS, en `/api/Products`, con máximo de páginas, y se detiene al haber 2 coincidencias.

Respuesta 200 (resumen):
```json
{ "data": {
  "origen": "BIND",
  "producto": { "ID": "…", "Code": "SCHFPMG001", "Title": "BOLSA VCI PMG 13 x 16\" CAL. 3 MIL PAQUETE C/200 BOLSAS", "Description": null, "Weight": 0.0428, "CreationDate": "2025-03-10T15:20:00Z" },
  "interpretacion": { "campos": { "tipo": {…}, "resina": {…}, "ancho": {…} }, "codigo": {…}, "familia": { "valor": null, "estado": "PENDIENTE_CONFIRMACION", "posiblesEstaFase": ["BOLSA_PLANA_1"] }, "pendientes": [], "advertencias": [] },
  "datosSugeridosPlantilla": { "codigo": "SCHFPMG001", "comp_pmg": "X", "pres_paquete": "X", "cantidad": "200 Bolsas", "ancho": "13\"", "largo": "16\"", "calibre": "3 MIL", "peso_bolsa_lb": "0.0428" },
  "familiaSugerida": ["BOLSA_PLANA_1"], "pendientes": [], "advertencias": [{ "codigo": "FAMILIA_NO_CONFIRMADA", "…": "…" }],
  "especificacionConfirmada": false } }
```
Errores: 400 (parámetro inválido, `BIND_INVALID_CODE` / `BIND_INVALID_ID`), 404 `BIND_PRODUCT_NOT_FOUND`, 409 `BIND_MULTIPLE_MATCHES` (no se elige ninguno; usar el ID),
502 (credenciales rechazadas por BIND, respuesta inválida, BIND caído), 503 (no configurado o límite de BIND), 504 (timeout). Las respuestas 5xx usan el cuerpo genérico del
filtro global del Hub: ningún mensaje de BIND llega al frontend. Un 401/403 de BIND (credenciales del servidor) se devuelve como 502, no como 401/403 del usuario.

## Confiabilidad
Timeout de 10 s por solicitud y 30 s en total; máximo 2 reintentos (esperas 0,5 s y 1,5 s, o `Retry-After` hasta 5 s) solo para 429, 408/5xx, red y timeout. **Nunca** se reintenta 400, 401, 403
ni una respuesta inválida. `redirect: 'error'`. Los límites de BIND (150 solicitudes/5 min con solo API Key; 300 con suscripción) hacen que no convenga consultar en bucle.

## Prueba real (opcional, manual)
1. Configura las claves **sin escribirlas en pantalla ni en chats**: agrégalas a `apps/api/.env` (Git lo ignora) con `BIND_API_KEY=…` (y `BIND_SUBSCRIPTION_KEY=…` si aplica), o defínelas en la sesión con `Read-Host -AsSecureString`.
2. Desde `apps/api`: `npm run bind:smoke -- SCHFPMG001`. Imprime solo ID, Code, Title, Weight, CreationDate, pendientes, advertencias y datos sugeridos; nunca las claves. Sin `BIND_API_KEY` termina con `PENDIENTE` (código 2) y no simula una conexión.
3. Resultado esperado para `SCHFPMG001`: producto encontrado, peso 0.0428 lb, sin pendientes y familia sin confirmar.
4. **Verifica el filtro por `Code`:** la documentación pública de BIND no detalla los operadores para propiedades de texto (su tabla de operadores es una imagen). Si BIND responde `BAD_REQUEST`, el `$filter` por `Code` necesita otra sintaxis; si ignora el filtro y devuelve otros productos, el cliente lo detecta como respuesta inválida y no elige ninguno.

## Limitaciones y decisiones pendientes
- **No verificado con BIND real** (sin credenciales en este entorno): la sintaxis `Code eq '…'` es la habitual de OData, pero no está documentada para texto.
- El filtro global de excepciones oculta el código de las respuestas 5xx; el frontend distingue 502/503/504 solo por estado.
- Añadir las claves al despliegue (`compose.pilot.yaml` / archivos de entorno) y definir su rotación.
- Sin búsqueda libre por descripción, paginación para UI ni sincronización; sin caché (cada consulta llama a BIND).

## Fase 3.1: `sugerencias`
La respuesta añade `sugerencias` (todas provisionales, editables y con regla de origen): `familia` (`valor` o `null`, `motivo` e `incompatibles`), `resinaVci` (`PMG AL 3%`, `CP5000 AL 3%`; Natural y otras no), `resinaVciPorComposicion`, `color` (Daubert Azul con 2 % de concentración de color salvo color explícito o contradictorio) y `etiqueta` (el `Title` completo). `familiaSugerida` contiene la familia de `sugerencias.familia.valor` (vacía si no hay). `interpretacion.campos.calibre.valor.textoLiteral` conserva el calibre tal como lo escribió BIND. Ninguna sugerencia confirma nada.

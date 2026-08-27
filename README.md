# Daubert Hub

Workspace for the Daubert Hub API and web application.

## Local development

From `C:\Users\06\Documents\Daubert\daubert-hub`:

1. Copy `apps/api/.env.example` to `apps/api/.env` and set non-production PostgreSQL credentials.
2. Run `npm install`.
3. Run `npm run dev`.

The API is exposed under `/api`; its health check is `GET /api/health`.

## Development routing

The Vite application runs on `http://localhost:5173` and uses `/api` as its default API base. During development, Vite proxies `/api/*` to NestJS at `http://localhost:3000`. This makes browser requests same-origin from the frontend's perspective and avoids local CORS requirements.

Production follows the same intent: one public origin served by a reverse proxy, with `/` routed to frontend assets and `/api/*` routed to NestJS. Frontend overrides belong in `apps/web/.env`; the normal value is `VITE_API_BASE_URL=/api`. API/database settings belong in `apps/api/.env`.

## Create provider

`POST /api/providers` creates one provider in a single PostgreSQL transaction. It accepts `commercialName`, `providerType` (`PROVEEDOR`, `SERVICIO`, or `FLETE`), optional `fiscal` (`legalName` and 12/13 character RFC), and optional `notes`.

```json
{
  "commercialName": "NOVAPAK",
  "providerType": "PROVEEDOR",
  "fiscal": {
    "legalName": "NOVAPAK S.A. DE C.V.",
    "rfc": "ABC123456XYZ"
  },
  "notes": null
}
```

Successful requests return `201 Created` with `data.id` and, when provided, `data.fiscal.id` represented as strings. The response also returns the generated or accepted `x-request-id` header.

Commercial and legal names are trimmed; RFC is trimmed and stored uppercase. A fiscal object must contain both values. Duplicate commercial names return `409 PROVIDER_NAME_ALREADY_EXISTS`; duplicate RFC values return `409 RFC_ALREADY_EXISTS`. The response returns bigint identifiers as strings and includes an `x-request-id` header.

The transaction writes `core.empresas`, its matching `core.empresa_roles` row, and optionally `core.empresas_fiscales`. It sets audit origin `DAUBERT_HUB` and the request ID for database triggers. It does not create Dropbox folders, invoke n8n, send notifications, or create contacts.

## List providers

`GET /api/providers` returns a paginated provider directory. It accepts optional `search`, `providerType`, `page`, `pageSize`, `sortBy`, and `sortOrder` query parameters. `providerType` is limited to `PROVEEDOR`, `SERVICIO`, and `FLETE`; `page` defaults to `1`, `pageSize` defaults to `25`, and the maximum page size is `100`. `sortBy` accepts `commercialName`, `providerType`, or `legalName`; `sortOrder` accepts `asc` or `desc`. The default is commercial-name ascending.

Provider inclusion is based on an active provider role, not on a negative company-type filter. Search is case-insensitive across commercial name and current fiscal legal name/RFC. The response is ordered by commercial name and returns bigint identifiers as strings.

```json
{
  "data": [
    {
      "id": "90",
      "commercialName": "Example Provider",
      "providerType": "SERVICIO",
      "status": "ACTIVO",
      "notes": null,
      "fiscal": { "id": "91", "legalName": "EXAMPLE PROVIDER SA DE CV", "rfc": "ABC123456XYZ" }
    }
  ],
  "meta": { "page": 1, "pageSize": 25, "total": 119, "totalPages": 5 }
}
```

## Provider detail

`GET /api/providers/:id` returns one provider profile when the company has an active provider role. It returns `404` for missing companies and companies that are not providers, and `400` for malformed or non-positive IDs. The response includes the compatible singular `providerType`, all active roles in deterministic order, active alternate commercial names in `aliases`, other active typed aliases in the read-only `otherAliases` collection, and only the current fiscal identity.

## Edit provider

`PATCH /api/providers/:id` updates provider fields and the company-owned final `aliases` set, returning the same representation as the detail endpoint. Alias reconciliation owns only active `NOMBRE_COMERCIAL_ALTERNATIVO` rows and leaves file, folder, and legal-name alias types untouched. Company and alias changes use one transaction; an alias already active for another company returns `409 ALIAS_ALREADY_ASSOCIATED`. `providerType` accepts `PROVEEDOR`, `SERVICIO`, or `FLETE`; for a single provider role it atomically updates both `core.empresas.tipo_empresa` and `core.empresa_roles`. A multi-role provider may be edited, but its type cannot be changed through this endpoint.

Fiscal input is `{ legalName, rfc, changeMode?, effectiveStartDate? }`. A provider without fiscal data can receive a complete identity. With an existing RFC, changing only the legal name updates the current row. A changed RFC requires `changeMode: "CORRECTION"` to correct the current row in place, or `changeMode: "NEW_IDENTITY"` plus `effectiveStartDate` (`YYYY-MM-DD`) to close the prior current identity and create a new current identity while retaining history. Clearing an existing fiscal identity is rejected. Duplicate commercial names return `409 PROVIDER_NAME_ALREADY_EXISTS`; duplicate RFCs return `409 RFC_ALREADY_EXISTS`.

## Safe testing

Automated unit tests never connect to `daubert_global`. Database integration tests require `TEST_DATABASE_URL` whose parsed database name is exactly `daubert_hub_test`; the test guard refuses every other target before mutations occur. `docker compose up postgres-test` provides an isolated local database on port 5433.

Run the complete safe suite with `npm run validate`.

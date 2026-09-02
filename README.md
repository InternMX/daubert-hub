# Daubert Hub

Workspace for the Daubert Hub API and web application.

## Project Purpose

Generic company-address management that can be reused by Providers and Clients,
built on a shared company model rather than separate physical tables. The database
already contains `core.direcciones` with address storage, audit triggers, and
active/inactive lifecycle; the API and UI now expose a generic CRUD surface.

## Current Architecture

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** NestJS 11 + TypeScript REST API
- **Database:** PostgreSQL (persistent, outside Docker in the pilot architecture)
- **Automation:** n8n (external to Docker, orchestration-only)
- **Monorepo:** npm workspaces (`apps/api`, `apps/web`)

## Runtime Environment Indicator

Development runs with `npm run dev`, which concurrently starts the API (`nest
start --watch`) and the Vite frontend (`vite`). The API listens on port 3000
(default) and the frontend on port 5173 (default). Vite proxies `/api/*` to the
API during development, making browser-origin same-origin and avoiding CORS.

## TEST vs PRODUCTION Database Separation

Database integration tests require `TEST_DATABASE_URL` whose decoded pathname is
exactly `daubert_hub_test`. The test guard refuses every other target before
fixture mutation or cleanup. Production access uses `daubert_global` and is
never connected from the test runner. No shared database between environments.

## npm Workspaces Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API + frontend concurrently |
| `npm run build` | Build API and frontend |
| `npm run typecheck` | Run TypeScript checks both workspaces |
| `npm run lint` | ESLint both workspaces |
| `npm run test` | Vitest unit tests both workspaces |
| `npm run test:integration` | Run all integration runners (requires `TEST_DATABASE_URL`) |
| `npm run validate` | Run typecheck + lint + test + test:integration + build |

## Local Development

1. `npm install`
2. Copy `apps/api/.env.example` to `apps/api/.env` (set non-production PostgreSQL
   credentials; do not commit secrets).
3. Run `npm run dev`.
4. The API health check is `GET /api/health`.
5. Vite proxies `/api/*` to the NestJS backend; override the API base in
   `apps/web/.env` if needed (`VITE_API_BASE_URL=/api`).

## Project Modules & Features

- **Home / Recent Activity** – filtered activity stream; address mutations are
  intentionally separate request/transaction groups so they do not interfere with
  classification of existing activities.
- **Providers** – role-specific facade over `core.empresas`; `CLIENTE`,
  `PROVEEDOR`, `SERVICIO`, `FLETE`.
- **Contacts** – contact management with methods; methods lifecycle (`POST
  /api/contacts/:id/methods`, `PATCH /api/contact-methods/:id`).
- **Company Aliases** – editable commercial aliases under `companies/`; reusable
  `CompanyAliasesField` component.
- **Company Addresses** – generic CRUD via `core.direcciones` owned through
  `empresa_id`. Six address types: `FISCAL`, `COMERCIAL`, `OPERATIVA`,
  `ENTREGA`, `FACTURACION`, `OTRA`; `ACTIVA`/`INACTIVA` status; principal
  uniqueness per company+type; transactional demotion; fiscal-owned rows are
  excluded from reads and mutations.
- **Automation Administration / Audi Folios** – series and adjustments managed
  through the automations module.

**Clients are planned next but are NOT implemented yet.** The same
`CompanyAddressesSection` component will be reused from the provider detail page
once client detail pages are built.

## Docker Pilot Deployment

A `docker compose` pilot stacks the API, frontend, and a test Postgres container.
Operational commands (docker start/stop, volume management, network config) are
documented in `deploy/README.md`; this README does not duplicate that guide.
PostgreSQL and n8n currently remain outside Docker in the pilot architecture.

## Database Migrations

Structural schema changes and permission grants are stored externally (in
`/mnt/c/Users/06/Documents/Dropbox/Pruebas/BASE DE DATOS/MIGRACIONES`) and are
not part of the Git repository. No migrations are run by `npm run dev` or
`npm run build`.

## Basic Testing / Validation Commands

- `npm run typecheck` – TypeScript across workspaces
- `npm run lint` – ESLint across workspaces
- `npm run test` – Vitest unit tests
- `npm run test:integration` – Integration runners (requires `TEST_DATABASE_URL`)
- `npm run validate` – Full safe suite (typecheck + lint + test + test:integration + build)

No passwords, connection secrets, or local credentials are included in this
file.
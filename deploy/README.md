# Internal pilot deployment

This deployment runs the compiled Daubert Hub web and API applications in Docker while continuing to use PostgreSQL on the Windows host. It does not containerize or expose PostgreSQL or n8n.

> **Scope of this guide (Spanish docs: [`docs/operations/deployment.md`](../docs/operations/deployment.md)).** This is the **generic** Compose reference, used mainly for TEST and for understanding the stack. The commands below use the example names `daubert-hub-prod` and port `8080`; they are **not** the real PROD values. Real PROD runs as Compose project `daubert-hub`, published on host port `8082`, with `compose.pilot.yaml` plus the host-local `compose.prod-temp.yaml`, and is deployed with `scripts/deploy/Deploy-DaubertHub.ps1`. For PROD follow [`docs/operations/deployment-checklist.md`](../docs/operations/deployment-checklist.md). Do not run `docker compose down` or `--remove-orphans` against PROD (the project name is shared with the development `compose.yaml`).

## Architecture

The browser connects only to the host port published by `web`. Nginx serves the compiled Vite SPA and forwards `/api` and `/api/*` unchanged to `api:3000` on the Compose bridge network. The API has no published host port and connects to Windows PostgreSQL at `host.docker.internal:5432`.

The API healthcheck calls `/api/health` and marks the container healthy only when the response contains `"database":"connected"`. `/api/health` is intentionally public and returns `status`, `database`, `environment`, `version`, and `commit`. The environment value is only the coarse classification `PRODUCTION`, `TEST`, or `UNKNOWN`; version and commit are non-secret build metadata used for deployment visibility. The endpoint does not expose the database host or name, credentials, usernames, connection strings, or other database fingerprints.

## Prerequisites

- Docker Desktop with Docker Compose and WSL integration enabled.
- The intended Windows-host PostgreSQL instance is already reachable from Docker Desktop at `host.docker.internal:5432`.
- The selected database and least-privilege application role already exist. This deployment does not change PostgreSQL configuration, run migrations, or create credentials.

Keep `API_PORT=3000`; Nginx and the private container port intentionally use port 3000.

## Environment files

Create the applicable untracked runtime file from its example and replace `CHANGE_ME` with the real password:

```text
deploy/pilot.test.env.example -> deploy/pilot.test.env
deploy/pilot.prod.env.example -> deploy/pilot.prod.env
```

The real files are explicitly ignored by Git. Do not put secrets in the example files, Compose file, Dockerfiles, image build arguments, or source-controlled application environment files.

## Validate configuration

Render the configuration before deployment. TEST example:

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env -f compose.pilot.yaml config
```

For PROD, use the preflight and the deploy runner described in [`docs/operations/deployment-checklist.md`](../docs/operations/deployment-checklist.md) instead of rendering the PROD configuration by hand.

Review rendered output carefully because `docker compose config` includes interpolated secrets.

## Deploy TEST

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env -f compose.pilot.yaml up -d --build
```

TEST is available on the host at `http://localhost:8081` with the example port.

## Deploy PROD

PROD is **not** deployed with a hand-typed `docker compose` command. Real PROD uses project `daubert-hub`, host port `8082` (`HUB_PORT` in `deploy/pilot.prod.env`), `compose.pilot.yaml` + `compose.prod-temp.yaml`, and the database `daubert_global` with the dedicated production application role. The only supported procedure is `scripts/deploy/Deploy-DaubertHub.ps1` (modes `-Preflight`, `-WhatIf`, `-Deploy`), documented in [`docs/operations/deployment-checklist.md`](../docs/operations/deployment-checklist.md). It recreates only `api` and `web`.

`deploy/pilot.prod.env.example` carries the generic example port `8080`; the real file sets `8082`. The distinct project names isolate container and network names so TEST and PROD can coexist when their host ports differ.

## Operations

Inspect status and logs without exposing internal services (TEST example):

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env -f compose.pilot.yaml ps
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env --env-file deploy/pilot.test.manufacturing.env -f compose.pilot.yaml logs
```

Stopping a TEST stack is a TEST-only operation (use the TEST project name and env file). `docker compose down` is **not** an operation for PROD: see the PROD prohibited operations in [`docs/operations/deployment-checklist.md`](../docs/operations/deployment-checklist.md#operaciones-prohibidas).

Only the configured `HUB_PORT` is published. The stack makes no Windows Firewall, router, PostgreSQL, migration, n8n, or production-data changes.

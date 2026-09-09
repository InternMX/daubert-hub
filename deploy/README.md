# Internal pilot deployment

This deployment runs the compiled Daubert Hub web and API applications in Docker while continuing to use PostgreSQL on the Windows host. It does not containerize or expose PostgreSQL or n8n.

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

Render each configuration before deployment:

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env -f compose.pilot.yaml config
docker compose --project-name daubert-hub-prod --env-file deploy/pilot.prod.env -f compose.pilot.yaml config
```

Review rendered output carefully because `docker compose config` includes interpolated secrets.

## Deploy TEST

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env -f compose.pilot.yaml up -d --build
```

TEST is available on the host at `http://localhost:8081` with the example port.

## Deploy PROD

Confirm the PROD file targets `daubert_global` and uses the dedicated production application role before running:

```bash
docker compose --project-name daubert-hub-prod --env-file deploy/pilot.prod.env -f compose.pilot.yaml up -d --build
```

PROD is available on the host at `http://localhost:8080` with the example port. The distinct `daubert-hub-test` and `daubert-hub-prod` project names isolate container and network names so both stacks can coexist when their host ports differ.

## Operations

Inspect status and logs without exposing internal services:

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env -f compose.pilot.yaml ps
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env -f compose.pilot.yaml logs
```

Stop a stack with the same project name and environment file:

```bash
docker compose --project-name daubert-hub-test --env-file deploy/pilot.test.env -f compose.pilot.yaml down
```

Only the configured `HUB_PORT` is published. The stack makes no Windows Firewall, router, PostgreSQL, migration, n8n, or production-data changes.

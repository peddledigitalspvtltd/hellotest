# HelloTest

HelloTest is a QA management workspace with a Fastify backend, a React frontend, PostgreSQL for relational persistence, and MinIO-compatible object storage for binary test evidence.

This repo is now PostgreSQL-first. SQLite is no longer part of the runtime, which avoids the read-only database file issues that were happening with mounted `.db` files.

## Stack

- Backend: Fastify on Node.js
- Frontend: React + Vite
- Database: PostgreSQL 16
- Attachments: MinIO / S3-compatible object storage through the official JavaScript SDK
- Containers: Docker Compose

## Repo layout

- `backend/api`: Fastify API
- `backend/db/schema.sql`: PostgreSQL schema loaded on first database boot
- `backend/db/seed.sql`: sample data loaded on first database boot
- `backend/docker-compose.yml`: backend + PostgreSQL + MinIO
- `docker-compose.full.yml`: full stack with PostgreSQL, MinIO, API, and frontend
- `docker-compose.platform.yml`: full stack plus HAProxy, Prometheus, Grafana, Loki, Promtail, and OpenTelemetry Collector
- `frontend`: React app
- `testengine`: standalone Playwright worker plane
- `openapi.yaml`: API contract

## Quick Start

Start everything from the repo root:

```bash
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --no-cache --stack local
```

Open the apps:

- Frontend: `http://localhost:8080`
- Administration portal (canonical API route): `http://localhost:3000/admin`
- Administration portal (direct container port): `http://localhost:8081`
- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- MinIO API: `localhost:9000`
- MinIO console: `http://localhost:9001`

On the first boot, the Postgres container creates the `hellotest` database and automatically runs:

- `backend/db/schema.sql`
- `backend/db/seed.sql`

## Operator Script

Use `hellotest.sh` as the single root entrypoint for service relation config, image publishing, and compose deployment:

```bash
./hellotest.sh config --stack full
./hellotest.sh push
./hellotest.sh deploy --stack platform
./hellotest.sh deploy --stack testengine --yes
```

`--build --no-cache` now rebuilds every Compose service without Docker layer cache before starting it, including both the product and administration frontend bundles. The equivalent full-stack command is:

```bash
docker compose -f docker-compose.full.yml up -d --build
```

For the cloud/edge stack, use:

```bash
./hellotest.sh deploy --build --no-cache --stack platform --yes
```

The edge route is `${HELLOTEST_PUBLIC_URL}/admin`; the API container also serves `/admin` directly whenever its port is exposed.

`./hellotest.sh config` writes the resolved service contract to `.hellotest/<stack>.env`. Override any endpoint or image with environment variables or `--config <file>`:

```bash
HELLOTEST_PUBLIC_URL=https://hellotest.example.com \
HELLOTEST_API_BASE_URL=https://hellotest.example.com/api \
./hellotest.sh deploy --stack platform
```

The deploy command prints the target stack, compose file, frontend URL, API URLs, and Test Engine URL before it changes containers. Use `--yes` only from automation.

For AWS EC2 hosts, prefer the scripts in [deploymentscripts](./deploymentscripts):

```bash
deploymentscripts/aws-app-deploy.sh
HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api deploymentscripts/aws-testengine-deploy.sh
deploymentscripts/aws-status.sh
deploymentscripts/aws-logs.sh --stack app
```

## Quick start: backend only

Run the backend and PostgreSQL without the frontend:

```bash
cd backend
docker pull postgres:16-alpine
docker compose up --build
```

You can also use:

```bash
cd backend
./start.sh
```

The API will be available at `http://localhost:3000`.

The Compose credentials are development defaults. Set unique `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_ACCESS_KEY`, and `MINIO_SECRET_KEY` values for every hosted environment; the API keeps these server-side and stores only object pointers and metadata in PostgreSQL.

## Start Individual Services

From the repo root, target services through the same operator script:

```bash
./hellotest.sh up --stack full postgres api
./hellotest.sh up --stack full frontend
./hellotest.sh up --stack testengine testengine
```

## Platform stack

For the stronger Docker edge and observability layer:

```bash
docker compose -f docker-compose.platform.yml up -d
```

That stack adds:

- HAProxy on `http://localhost`
- Prometheus on `http://localhost:9090`
- Grafana on `http://localhost:3001`
- Loki on `http://localhost:3100`
- HAProxy stats on `http://localhost:8404/stats`

If port `80` is already used on the host, publish HAProxy on another host port:

```bash
HELLOTEST_HTTP_PORT=8081 docker compose -f docker-compose.platform.yml up -d
```

More detail is in [PLATFORM_STACK.md](./PLATFORM_STACK.md).

## Manual PostgreSQL setup

If you want to run Postgres yourself instead of using Compose, these are the explicit steps.

1. Pull the image:

```bash
docker pull postgres:16-alpine
```

2. Start PostgreSQL:

```bash
docker run --name hellotest-postgres \
  -e POSTGRES_DB=hellotest \
  -e POSTGRES_USER=hellotest \
  -e POSTGRES_PASSWORD=hellotest \
  -p 5432:5432 \
  -d postgres:16-alpine
```

3. Load the schema:

```bash
PGPASSWORD=hellotest psql -h localhost -U hellotest -d hellotest -f backend/db/schema.sql
```

4. Load the sample data:

```bash
PGPASSWORD=hellotest psql -h localhost -U hellotest -d hellotest -f backend/db/seed.sql
```

5. Run the API locally:

```bash
cd backend/api
npm install
DATABASE_URL=postgresql://hellotest:hellotest@localhost:5432/hellotest npm start
```

6. Run the frontend locally in another terminal:

```bash
cd frontend
npm install
VITE_API_BASE_URL=http://localhost:3000 npm run dev
```

Run the administration portal as a separate Vite process only when developing its UI. It uses the same API and PostgreSQL database as the product workspace:

```bash
cd frontend
VITE_API_BASE_URL=http://localhost:3000 npm run dev:admin
```

Vite opens the portal under `http://localhost:5174/admin/`; a locally running API also gateways it at `http://localhost:3000/admin`. In Docker, no extra npm process is needed: the admin bundle is included in the frontend image. For a new instance, sign in with `admin` / `admin`, then replace the bootstrap password from **Security**. Production deployments should disable bootstrap login after onboarding a permanent administrator with `ADMIN_BOOTSTRAP_ENABLED=false`, or provide `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD` during first boot.

## Sample login

The seed file creates these users:

- `admin@hellotest.ai` / `admin123`
- `member@hellotest.ai` / `member123`

## Environment variables

### Backend

- `DATABASE_URL`
  Example: `postgresql://hellotest:hellotest@postgres:5432/hellotest`
- `SESSION_SECRET`
- `CORS_ORIGIN`
- `LOG_LEVEL`
- `STORAGE_PROVIDER` (`minio` for the bundled object store, or `s3` for a compatible hosted endpoint)
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_REGION`
- `MAX_ATTACHMENT_BYTES` (defaults to 100 MiB)

Attachment uploads are streamed through the authenticated API. PostgreSQL stores the HelloTest entity scope, object key, checksum, content type, and audit metadata; file bytes remain in object storage and downloads are lazy. Keep object-storage credentials on the API service only—never expose them through the frontend runtime config.

### PostgreSQL container

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

### Frontend

- `HELLOTEST_API_BASE_URL` for the container build/runtime config
  Example: `http://localhost:3000` for `docker-compose.full.yml`, or `/api` when the frontend and API share the same public host behind HAProxy or a load balancer
- `VITE_API_BASE_URL` for local Vite development
- `HELLOTEST_ADMIN_URL` for the public administration portal URL reported by `hellotest.sh`
- `HELLOTEST_ADMIN_PORT` for the optional direct administration frontend port (defaults to `8081`)
- `ADMIN_FRONTEND_INTERNAL_URL` for the API-to-frontend Docker route (defaults to `http://frontend:81`)
- `HELLOTEST_BACKEND_IMAGE` to override the backend Docker Hub image
- `HELLOTEST_FRONTEND_IMAGE` to override the frontend Docker Hub image

## Database behavior

- The official `postgres:16-alpine` image creates the database defined by `POSTGRES_DB`.
- The mounted SQL files in `backend/db` are executed only when the Postgres data directory is empty.
- Sample data is inserted from `backend/db/seed.sql`, so the backend and frontend have working starter content immediately.

## Reset the database

If you want a fresh database and fresh seed data:

From the repo root:

```bash
docker compose -f docker-compose.full.yml down -v
docker compose -f docker-compose.full.yml pull
docker compose -f docker-compose.full.yml up -d
```

From the backend folder:

```bash
docker compose down -v
docker compose up --build
```

## Notes

- `docker-compose.full.yml` now uses Docker Hub images by default:
- Backend: `jayarajumetta/hellotest-backend:latest`
- Frontend: `jayarajumetta/hellotest-frontend:latest`
- The frontend is configured to talk to `http://localhost:3000` by default in local Docker workflows.
- The schema in `backend/db/schema.sql` is ordered for PostgreSQL foreign key creation, and `seed.sql` uses PostgreSQL boolean values.

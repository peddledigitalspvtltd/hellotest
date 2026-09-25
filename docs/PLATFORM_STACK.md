# HelloTest Platform Stack

The platform profile is a single-command local/VM deployment with explicit readiness ordering and a complete three-signal observability path.

## Start and verify

```bash
./hellotest.sh config --stack platform
./hellotest.sh deploy --stack platform
./scripts/validate-deployment-contracts.sh
```

Generated `.hellotest/*.env` files are mode `600` inside a mode `700` directory. `./hellotest.sh config` redacts secrets by default; use `--show-secrets` only in a controlled terminal.
For the platform and standalone Test Engine profiles, missing secrets are generated with cryptographic randomness and reused from the protected env file on later commands. The production Compose profile fails closed when those secrets are absent instead of falling back to development credentials.
The platform database initializes schema only; it never installs the known sample accounts from `backend/db/seed.sql`. A random one-time bootstrap administrator is created from the protected deployment env file and is forced through password replacement after first sign-in. Sample content remains an explicit Administration action.

On a new platform installation, retrieve that one-time identity only from a private terminal:

```bash
./hellotest.sh config --stack platform --show-secrets
```

Sign in, replace the bootstrap password immediately, then set `ADMIN_BOOTSTRAP_ENABLED=false` in the deployment configuration. Existing databases that still contain the published legacy sample hashes have those accounts automatically suspended and de-privileged on a production API start.

## Runtime topology

- PostgreSQL/pgvector stores transactional, execution, and Knowledge Repo vector data.
- Redis provides cache and coordination.
- MinIO stores attachments and generated artifacts.
- Apache Tika performs isolated rich-document extraction.
- Fastify serves the API and administration gateway.
- Nginx serves the product and administration frontends.
- HAProxy is the public HTTP front door.
- Prometheus scrapes API metrics and evaluates runtime alerts.
- Loki and Promtail collect container logs.
- OpenTelemetry Collector receives OTLP, enforces memory/redaction/batching policy, and exports traces and logs.
- Jaeger v2 stores and queries local traces.
- Grafana provisions Prometheus, Loki, Jaeger, trace/log correlation, and the HelloTest Runtime Overview dashboard.
- `testengine/backend` is the only supported execution worker plane; the legacy `apps/hellotest-execution-engine` tree is archived source and has no deployment contract.

The bundled Jaeger all-in-one profile uses bounded single-node memory storage and is intended for local or light VM operations. A production deployment should point the Collector exporter and the admin trace URL at an organization-managed persistent tracing backend.
The bundled, version-pinned MinIO node is likewise a reproducible local/light-VM S3-compatible provider. Security-sensitive production deployments should configure `STORAGE_PROVIDER=s3` with an actively maintained, organization-managed object store and its normal backup/lifecycle controls.

## Health contracts

- `/health` and `/health/live`: process liveness only.
- `/health/ready`: critical PostgreSQL stores; returns 503 when the API must leave rotation.
- `/admin/health`: authenticated full dependency registry including Redis, storage, Tika, telemetry, schema, attachments, and permissions.
- MinIO uses `/minio/health/ready`.
- Compose consumers wait for `service_healthy`, not merely a started container.

## Operator endpoints

Defaults can be changed with the corresponding `HELLOTEST_*` environment variable.

| Endpoint | Default |
| --- | --- |
| Product | `http://localhost` |
| Administration | `http://localhost:8081/admin/` |
| API | `http://localhost:3000` |
| Grafana | `http://localhost:3001` |
| Jaeger | `http://localhost:16686` |
| Prometheus | `http://localhost:9090` |
| HAProxy statistics | `http://localhost:8404/stats` |

## Configuration ownership

Infrastructure addresses and credentials come from environment/secrets management and require a restart. Project-scoped LLM, Test Engine, OPS, email, source-control, and other provider settings remain governed through Administration > Integrations. This prevents a compromised browser session from rewriting database or telemetry infrastructure while still making provider services pluggable.

See [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md) for dependency rules and service contracts.

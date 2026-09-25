# Operating the compact monitoring stack

The canonical definition is `docker-compose.ops.yml`. The platform Compose file extends it, so limits, images, mounts, and service responsibilities have one owner. `services/catalog.json` lists operational infrastructure separately from application domains. Promtail is removed; Alloy owns container log collection. The Collector owns application OTLP intake. Neither is an application startup/readiness dependency.

## Start and verify

```sh
# Application + all eight ops services (local stack)
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache

# Monitoring only / repair network attachments
npm run ops:up
npm run ops:status
node scripts/ops/verify.mjs
```

The operator script creates a random Grafana password in `.hellotest/ops.env` with mode 600, starts the ops services, and attaches the running local API and frontend to the `hellotest-ops` network without restarting them. Set `OPS_API_CONTAINER` and `OPS_FRONTEND_CONTAINER` for other installations. `hellotest.sh up/deploy --stack local` automatically starts monitoring and repairs these attachments after container recreation. `status --stack local` includes ops; `down --stack local` also stops ops without removing telemetry volumes. Use `HELLOTEST_OPS_ENABLED=false` to opt out. Monitoring startup failures print a warning while application startup remains successful. When using Docker Compose directly, re-run `ops:up` after recreating application containers. The platform deployment shares its own Compose network and does not need this attachment step.

In the application API, set `OPS_MONITORING_ENABLED=true` to enable the **Test Ops → Telemetry → Service health** view. It uses an authenticated, project-authorized backend endpoint, checks at most four components concurrently, gives each check 1.5 seconds, and caches/coalesces results for 30 seconds. The browser polls once per minute only while visible. Component failures produce partial availability rather than an application error; internal addresses and credentials are not returned.

## Test Ops views

Open `/ops-telemetry` (Test Ops → Telemetry). The workspace has seven tabs: **Dashboard**, **Grafana dashboard**, **Project execution telemetry**, **Infrastructure logs**, **Distributed traces**, **Alertmanager**, and **Service health**. The dashboard shows live Prometheus values and scrape-target status; logs read the latest 100 Loki lines from the last 15 minutes with a local text filter; Alertmanager embeds its console for alert filtering, grouping, and silence inspection. Distributed traces embeds Jaeger search, span inspection, and dependencies, initially searching the API service over the last hour. Project execution telemetry renders only in its own tab. Service health combines application readiness checks (previously in Admin-space) with monitoring component health. Existing `/admin-space?section=health` links redirect here.

Dashboard, Grafana, distributed traces, infrastructure logs, and alerts require the existing **workspace administrator** role, project access, and `ops.view`, because their data covers the entire deployment. Non-administrators retain project telemetry and service health. The Grafana tab signs in automatically through a same-origin backend gateway, using a dedicated Viewer account. Anonymous Grafana access remains disabled. All consoles load within their selected tab; there are no external launch links. The old `/traces` application route redirects to the Distributed traces tab. Grafana uses username `admin` and the password in the protected `.hellotest/ops.env` file. Remote deployments should access the consoles through the operator's authenticated gateway/SSH tunnel.

The native dashboard/log views query only while mounted/visible, has a 3-second backend deadline, fixed queries, a 512 KiB response bound, 15-second caching/coalescing, and no automatic retry storm. A failed source shows an unavailable state and a Refresh action without preventing other tabs from working. Missing metric samples display “No sample”; they are not reported as zero. Health checks have their separate 30-second cache. New API containers may need two Prometheus scrapes before rate metrics appear.

The embedded dashboard uses a 15-minute encrypted HttpOnly cookie, renewed every ten minutes while visible. The gateway rechecks the original HelloTest session, administrator role, and project access on each request; cross-site requests and write APIs are rejected. Logout clears the cookie. Reconnect handles expired sessions or a recovered Grafana service. Credentials stay on the API server. Assets stream with a 20 MiB response limit and 20-second deadline; datasource request bodies are capped at 256 KiB and twenty queries. Grafana Live connections are disabled for this read-only dashboard.

Local startup imports Grafana credentials from `.hellotest/ops.env` into the private API environment automatically. Other deployments must configure `OPS_GRAFANA_USER`, `OPS_GRAFANA_PASSWORD`, and `OPS_GRAFANA_URL` (origin only). Platform Compose supplies these from its Grafana settings. Grafana serves under `/api/ops-telemetry/grafana/` with embedding enabled; `OPS_GRAFANA_PUBLIC_URL` controls the standalone console origin, defaulting to `http://localhost:3001`. Keep the proxy and Grafana subpath aligned. The gateway provisions its Viewer with the documented [Grafana administrator APIs](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/admin/) and verifies its organization role with the [user APIs](https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/api-legacy/user/).

Jaeger and Alertmanager use the same administrator/project checks with separate, provider-scoped HttpOnly cookies. Only allowlisted GET resources are forwarded; creating/deleting silences and archiving traces are not enabled by this read-only integration. Logout clears all three console cookies. Only the selected tab mounts its console, limiting background work. Set `OPS_JAEGER_URL` (default `http://hellotest-ops-jaeger:16686`) or `OPS_ALERTMANAGER_URL` (default `http://hellotest-ops-alertmanager:9093`) for different internal origins. The frontend gateway routes `/api/ops-telemetry/` to the Trace service in microservice mode. API browser sessions and embedded consoles must share that gateway origin.

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://hellotest-ops-otel-collector:4318` for application containers attached to the standalone stack. The platform uses `http://otel-collector:4318`. Local API defaults to the consolidated Collector. The previous standalone local Jaeger is available only with the `legacy-tracing` Compose profile; do not run it alongside the consolidated stack. To use that fallback, explicitly set the OTLP endpoint to `http://jaeger:4318`. Application export uses a 512-span queue, 128-span batches, a two-second deadline and 10% parent-based sampling by default. Operator-supplied sampler/queue environment settings take precedence.

| Component | Local endpoint | Container memory ceiling |
| --- | --- | ---: |
| HAProxy | http://localhost:18080; statistics on :18404/stats | 64 MiB |
| Prometheus | http://localhost:9090 | 256 MiB |
| Grafana | http://localhost:3001 | 256 MiB |
| Loki | http://localhost:3100 | 384 MiB |
| Jaeger | http://localhost:16687 | 256 MiB |
| Alloy | http://localhost:12345 | 192 MiB |
| Collector | OTLP HTTP :4319; gRPC :4320; health :13133 | 256 MiB |
| Alertmanager | http://localhost:9093 | 64 MiB |

All standalone published ports bind to loopback. Remote operators should use SSH forwarding or an authenticated TLS gateway; do not publish log/trace APIs directly. The platform additionally preserves its configurable public HAProxy port (80 by default). Grafana requires login. Alertmanager groups alerts locally; external email/Slack delivery is intentionally not configured.

## Resource and retention policy

- Total configured container memory ceiling: 1,728 MiB; each component has a 0.5 CPU quota and 128-process limit. These are ceilings, not reservations, and exclude Docker/build overhead.
- Prometheus retains at most two days or 256 MB of TSDB blocks, with two concurrent queries, bounded samples, and 30-second collection. WAL/head data adds overhead beyond the block limit.
- Loki keeps logs for 24 hours, with a 0.01 MB/s sustained ingestion allowance, 1 MB burst, 16 KB line limit, 1,000-stream limit, two concurrent queries, and periodic deletion. Alloy limits ingestion to five lines per second and drops delivery failures after bounded retries. These limits deliberately favor application availability over complete high-volume log retention.
- Loki retention and ingestion limits constrain growth but are not a filesystem quota. Named volumes still require host disk monitoring/quota management. Retention deletion has a grace period. Do not describe these defaults as an exact disk-size ceiling.
- Jaeger keeps a bounded in-memory cache of 2,000 recent traces. Trace history is diagnostic and resets on restart. Durable compliance/history requirements need a separately sized storage backend, not an unlimited local Badger archive.
- Collector queues are capped at 4 MB per exporter, with two consumers and 30 seconds of bounded retries. There is no unbounded disk spool. Prolonged backend outages drop telemetry.
- Docker logs rotate at three files of 5 MB per component. Alloy excludes its own logs to avoid delivery-error feedback loops. Source-side redaction remains primary; collector redaction is defense in depth.

## Failure behavior

Application operations do not await Collector/Loki/Jaeger availability. Prometheus, Grafana, Alloy, the Collector and Alertmanager start independently. A missing datasource produces missing diagnostics; it does not restart unrelated services. HAProxy resolves backends dynamically and starts while they are absent.

A single-instance component cannot provide its own function while stopped: Grafana cannot render dashboards if Grafana is down, and an edge-only deployment loses that entry point if HAProxy is down. Other services continue, and containers restart automatically after process failure. This is isolation and recovery, not high availability. A production availability guarantee requires replicas, multiple hosts and external routing/storage.

Run `node scripts/ops/verify.mjs --faults` only during an authorized resilience check. It stops each **ops container** in turn, verifies the local application and other ops readiness endpoints, then restarts it in `finally`. It never stops application or database containers. Jaeger's diagnostic cache resets during this test. The normal verifier checks application metric scraping, Alertmanager discovery, authenticated Grafana datasource reads, trace delivery through the Collector, and container log delivery through Alloy.

Keep the monitoring network separate from public networks. The Docker socket used by Alloy is privileged even when mounted read-only; use a restricted Docker API proxy in deployments where the collector is not equally trusted with the host. No telemetry endpoint should be exposed as an unauthenticated cross-project viewer in Test Ops.

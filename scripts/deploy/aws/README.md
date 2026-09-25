# HelloTest AWS Deployment Scripts

These scripts are the preferred EC2 entrypoints for AWS-style deployment. The root [hellotest.sh](../../../hellotest.sh) script owns image publishing, service relation config, and compose orchestration; these wrappers add AWS-safe bind defaults and quick status/log checks.

## Recommended AWS Shape

- Build/release host or CI:
  - runs `./hellotest.sh push`
  - builds and pushes backend, frontend, and Test Engine images
- App EC2:
  - runs only the platform plane
  - services: Postgres, API, frontend, HAProxy, Prometheus, Grafana, Loki, Alloy, OTel Collector
  - command: `scripts/deploy/aws/deploy-app.sh`
- Test Engine EC2:
  - runs only the worker/browser plane
  - services: Test Engine, Selenium Hub, Selenium Chromium node
  - command: `scripts/deploy/aws/deploy-testengine.sh`

Avoid ad hoc `docker compose up` on EC2 after switching to the platform stack. App hosts should refresh through `./hellotest.sh deploy --stack platform` or `scripts/deploy/aws/deploy-app.sh` so service URLs and bind defaults stay consistent.

## Deploy App Host

```bash
scripts/deploy/aws/deploy-app.sh
```

By default this publishes HAProxy on host port `8081` and binds internal/admin services to `127.0.0.1`.

Common variants:

```bash
scripts/deploy/aws/deploy-app.sh --http-port 80
HELLOTEST_HTTP_BIND=127.0.0.1 scripts/deploy/aws/deploy-app.sh --http-port 8081
```

Use `HELLOTEST_HTTP_BIND=127.0.0.1` when nginx/Caddy/Apache on the same instance owns ports `80` and `443` and proxies to HelloTest locally. Use `HELLOTEST_HTTP_BIND=0.0.0.0` when an AWS ALB targets the instance port directly, and restrict access with security groups.

## Deploy Test Engine Host

```bash
HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api \
scripts/deploy/aws/deploy-testengine.sh
```

If EC2 instance metadata is available, the script derives `ENGINE_PUBLIC_URL` from the public IPv4. You can set it explicitly:

```bash
HELLOTEST_API_BASE_URL=https://hellotest.qualipal.in/api \
ENGINE_PUBLIC_URL=http://13.55.32.201:4301 \
scripts/deploy/aws/deploy-testengine.sh
```

Selenium Grid and VNC bind to `127.0.0.1` by default. Do not expose ports `4444` or `7900` publicly unless you have a temporary debugging reason and a restrictive security group.

## Status And Logs

```bash
scripts/deploy/aws/status.sh
scripts/deploy/aws/status.sh --stack app
scripts/deploy/aws/status.sh --stack testengine

scripts/deploy/aws/logs.sh --stack app --tail 200
scripts/deploy/aws/logs.sh --stack testengine --tail 200
```

`hellotest-api` is the backend/API service. A separate `backend` container is not expected.

## AWS Security Group Baseline

App EC2:

- Public or ALB-only: `80`/`443`, or the chosen HelloTest HAProxy port such as `8081`
- SSH: only from admin IPs
- Keep `3000`, `5432`, `3001`, `9090`, `3100`, `4317`, `4318`, `9464`, and `8404` private or localhost-only

Test Engine EC2:

- Public or app/VPN-only: `4301`
- SSH: only from admin IPs
- Keep `4444` and `7900` private or localhost-only

Production next step: move PostgreSQL to RDS, push images to ECR, and eventually run the app and worker planes on ECS/Fargate behind ALB target groups.

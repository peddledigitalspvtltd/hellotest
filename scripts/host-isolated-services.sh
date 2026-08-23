#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-compose}"
ACTION="${2:-up}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${HELLOTEST_ISOLATED_OUT_DIR:-${ROOT_DIR}/.hellotest-isolated}"

mkdir -p "${OUT_DIR}"

API_IMAGE="${HELLOTEST_BACKEND_IMAGE:-jayarajumetta/hellotest-backend:latest}"
FRONTEND_IMAGE="${HELLOTEST_FRONTEND_IMAGE:-jayarajumetta/hellotest-frontend:latest}"
TESTENGINE_IMAGE="${HELLOTEST_TESTENGINE_IMAGE:-jayarajumetta/hellotest-testengine:latest}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"

POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5432}"
API_HOST_PORT="${API_HOST_PORT:-3000}"
FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-8080}"
TESTENGINE_API_HOST_PORT="${TESTENGINE_API_HOST_PORT:-4301}"
MOBILE_ENGINE_HOST_PORT="${MOBILE_ENGINE_HOST_PORT:-4312}"
SELENIUM_HOST_PORT="${SELENIUM_HOST_PORT:-4444}"
SELENIUM_VNC_HOST_PORT="${SELENIUM_VNC_HOST_PORT:-7900}"

COMPOSE_FILE="${OUT_DIR}/docker-compose.isolated.yml"
K8S_FILE="${OUT_DIR}/hellotest-isolated.k8s.yaml"

write_compose() {
  cat > "${COMPOSE_FILE}" <<YAML
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    container_name: hellotest-postgres-isolated
    hostname: hellotest-postgres
    ports:
      - "${POSTGRES_HOST_PORT}:5432"
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-hellotest}
      POSTGRES_USER: \${POSTGRES_USER:-hellotest}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-hellotest}
    volumes:
      - hellotest-isolated-postgres:/var/lib/postgresql/data
      - ${ROOT_DIR}/backend/db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
      - ${ROOT_DIR}/backend/db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-hellotest} -d \${POSTGRES_DB:-hellotest}"]
      interval: 5s
      timeout: 5s
      retries: 24
    networks:
      hellotest-data:
        aliases:
          - postgres

  api:
    image: ${API_IMAGE}
    container_name: hellotest-api-isolated
    hostname: hellotest-api
    ports:
      - "${API_HOST_PORT}:3000"
    environment:
      DATABASE_URL: \${DATABASE_URL:-postgresql://hellotest:hellotest@postgres:5432/hellotest}
      SESSION_SECRET: \${SESSION_SECRET:-hellotest-dev-secret}
      CORS_ORIGIN: \${CORS_ORIGIN:-http://localhost:${FRONTEND_HOST_PORT},http://127.0.0.1:${FRONTEND_HOST_PORT}}
      TESTENGINE_CALLBACK_SECRET: \${TESTENGINE_CALLBACK_SECRET:-hellotest-testengine-dev-secret}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      hellotest-data: {}
      hellotest-app:
        aliases:
          - api
    restart: unless-stopped

  frontend:
    image: ${FRONTEND_IMAGE}
    container_name: hellotest-frontend-isolated
    hostname: hellotest-frontend
    ports:
      - "${FRONTEND_HOST_PORT}:80"
    environment:
      HELLOTEST_API_BASE_URL: \${HELLOTEST_API_BASE_URL:-/api}
    depends_on:
      - api
    networks:
      hellotest-app:
        aliases:
          - frontend
    restart: unless-stopped

  selenium:
    image: selenium/standalone-chromium:latest
    container_name: hellotest-selenium-isolated
    hostname: hellotest-selenium
    shm_size: 2gb
    ports:
      - "${SELENIUM_HOST_PORT}:4444"
      - "${SELENIUM_VNC_HOST_PORT}:7900"
    environment:
      SE_NODE_MAX_SESSIONS: \${SE_NODE_MAX_SESSIONS:-4}
      SE_NODE_OVERRIDE_MAX_SESSIONS: "true"
      SE_START_XVFB: "true"
    networks:
      hellotest-engine:
        aliases:
          - selenium

  testengine:
    image: ${TESTENGINE_IMAGE}
    container_name: hellotest-testengine-isolated
    hostname: hellotest-testengine
    ports:
      - "${TESTENGINE_API_HOST_PORT}:4301"
    environment:
      PORT: 4301
      HELLOTEST_API_BASE_URL: \${HELLOTEST_API_BASE_URL:-http://api:3000}
      HELLOTEST_TESTENGINE_SECRET: \${HELLOTEST_TESTENGINE_SECRET:-hellotest-testengine-dev-secret}
      SELENIUM_GRID_URL: \${SELENIUM_GRID_URL:-http://selenium:4444/wd/hub}
      TESTENGINE_POLL_CONCURRENCY: \${TESTENGINE_POLL_CONCURRENCY:-4}
      TESTENGINE_WORKER_CLASS: \${TESTENGINE_WORKER_CLASS:-hybrid}
      ARTIFACT_ROOT: /artifacts
    volumes:
      - hellotest-isolated-artifacts:/artifacts
    depends_on:
      - api
      - selenium
    networks:
      hellotest-app: {}
      hellotest-engine:
        aliases:
          - testengine
    restart: unless-stopped

  mobile-engine:
    build:
      context: ${ROOT_DIR}/local-run/mobile-engine
    container_name: hellotest-mobile-engine-isolated
    hostname: hellotest-mobile-engine
    ports:
      - "${MOBILE_ENGINE_HOST_PORT}:4312"
    environment:
      PORT: 4312
      APPIUM_SERVER_URL: \${APPIUM_SERVER_URL:-http://host.docker.internal:4723}
      HELLOTEST_API_BASE_URL: \${HELLOTEST_API_BASE_URL:-http://api:3000}
    networks:
      hellotest-app: {}
      hellotest-engine:
        aliases:
          - mobile-engine
    restart: unless-stopped

networks:
  hellotest-data:
    driver: bridge
  hellotest-app:
    driver: bridge
  hellotest-engine:
    driver: bridge

volumes:
  hellotest-isolated-postgres:
  hellotest-isolated-artifacts:
YAML
}

write_k8s() {
  cat > "${K8S_FILE}" <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: hellotest-isolated
---
apiVersion: v1
kind: Secret
metadata:
  name: hellotest-secrets
  namespace: hellotest-isolated
stringData:
  postgres-password: "${POSTGRES_PASSWORD:-hellotest}"
  session-secret: "${SESSION_SECRET:-hellotest-dev-secret}"
  testengine-secret: "${HELLOTEST_TESTENGINE_SECRET:-hellotest-testengine-dev-secret}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: hellotest-isolated
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: ${POSTGRES_IMAGE}
          ports:
            - containerPort: 5432
          env:
            - name: POSTGRES_DB
              value: hellotest
            - name: POSTGRES_USER
              value: hellotest
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: hellotest-secrets
                  key: postgres-password
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: hellotest-isolated
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: hellotest-isolated
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: ${API_IMAGE}
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              value: postgresql://hellotest:hellotest@postgres:5432/hellotest
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: hellotest-secrets
                  key: session-secret
            - name: TESTENGINE_CALLBACK_SECRET
              valueFrom:
                secretKeyRef:
                  name: hellotest-secrets
                  key: testengine-secret
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: hellotest-isolated
spec:
  selector:
    app: api
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: testengine
  namespace: hellotest-isolated
spec:
  replicas: 3
  selector:
    matchLabels:
      app: testengine
  template:
    metadata:
      labels:
        app: testengine
    spec:
      containers:
        - name: testengine
          image: ${TESTENGINE_IMAGE}
          ports:
            - containerPort: 4301
          env:
            - name: PORT
              value: "4301"
            - name: HELLOTEST_API_BASE_URL
              value: http://api:3000
            - name: HELLOTEST_TESTENGINE_SECRET
              valueFrom:
                secretKeyRef:
                  name: hellotest-secrets
                  key: testengine-secret
            - name: SELENIUM_GRID_URL
              value: http://selenium:4444/wd/hub
            - name: TESTENGINE_POLL_CONCURRENCY
              value: "4"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: testengine
  namespace: hellotest-isolated
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: testengine
  minReplicas: 1
  maxReplicas: 12
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: selenium
  namespace: hellotest-isolated
spec:
  replicas: 2
  selector:
    matchLabels:
      app: selenium
  template:
    metadata:
      labels:
        app: selenium
    spec:
      containers:
        - name: selenium
          image: selenium/standalone-chromium:latest
          ports:
            - containerPort: 4444
            - containerPort: 7900
          env:
            - name: SE_NODE_MAX_SESSIONS
              value: "4"
            - name: SE_NODE_OVERRIDE_MAX_SESSIONS
              value: "true"
---
apiVersion: v1
kind: Service
metadata:
  name: selenium
  namespace: hellotest-isolated
spec:
  selector:
    app: selenium
  ports:
    - name: webdriver
      port: 4444
      targetPort: 4444
    - name: vnc
      port: 7900
      targetPort: 7900
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: hellotest-isolated
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: ${FRONTEND_IMAGE}
          ports:
            - containerPort: 80
          env:
            - name: HELLOTEST_API_BASE_URL
              value: /api
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: hellotest-isolated
spec:
  type: LoadBalancer
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
YAML
}

case "${MODE}" in
  compose)
    write_compose
    case "${ACTION}" in
      up)
        docker compose -f "${COMPOSE_FILE}" up -d
        ;;
      down)
        docker compose -f "${COMPOSE_FILE}" down
        ;;
      config)
        docker compose -f "${COMPOSE_FILE}" config
        ;;
      *)
        echo "Unknown compose action: ${ACTION}" >&2
        exit 2
        ;;
    esac
    echo "Compose manifest: ${COMPOSE_FILE}"
    ;;
  k8s|kubernetes)
    write_k8s
    case "${ACTION}" in
      apply)
        kubectl apply -f "${K8S_FILE}"
        ;;
      delete)
        kubectl delete -f "${K8S_FILE}"
        ;;
      print)
        cat "${K8S_FILE}"
        ;;
      *)
        echo "Kubernetes manifest: ${K8S_FILE}"
        ;;
    esac
    ;;
  *)
    echo "Usage: scripts/host-isolated-services.sh [compose|k8s] [up|down|config|apply|delete|print]" >&2
    exit 2
    ;;
esac

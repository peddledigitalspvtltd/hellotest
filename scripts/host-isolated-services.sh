#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-compose}"
ACTION="${2:-up}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${QAIRA_ISOLATED_OUT_DIR:-${ROOT_DIR}/.qaira-isolated}"

mkdir -p "${OUT_DIR}"

API_IMAGE="${QAIRA_BACKEND_IMAGE:-jayarajumetta/qaira-backend:latest}"
FRONTEND_IMAGE="${QAIRA_FRONTEND_IMAGE:-jayarajumetta/qaira-frontend:latest}"
TESTENGINE_IMAGE="${QAIRA_TESTENGINE_IMAGE:-jayarajumetta/qaira-testengine:latest}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"

POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5432}"
API_HOST_PORT="${API_HOST_PORT:-3000}"
FRONTEND_HOST_PORT="${FRONTEND_HOST_PORT:-8080}"
TESTENGINE_API_HOST_PORT="${TESTENGINE_API_HOST_PORT:-4301}"
MOBILE_ENGINE_HOST_PORT="${MOBILE_ENGINE_HOST_PORT:-4312}"
SELENIUM_HOST_PORT="${SELENIUM_HOST_PORT:-4444}"
SELENIUM_VNC_HOST_PORT="${SELENIUM_VNC_HOST_PORT:-7900}"

COMPOSE_FILE="${OUT_DIR}/docker-compose.isolated.yml"
K8S_FILE="${OUT_DIR}/qaira-isolated.k8s.yaml"

write_compose() {
  cat > "${COMPOSE_FILE}" <<YAML
services:
  postgres:
    image: ${POSTGRES_IMAGE}
    container_name: qaira-postgres-isolated
    hostname: qaira-postgres
    ports:
      - "${POSTGRES_HOST_PORT}:5432"
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-qaira}
      POSTGRES_USER: \${POSTGRES_USER:-qaira}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-qaira}
    volumes:
      - qaira-isolated-postgres:/var/lib/postgresql/data
      - ${ROOT_DIR}/backend/db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
      - ${ROOT_DIR}/backend/db/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-qaira} -d \${POSTGRES_DB:-qaira}"]
      interval: 5s
      timeout: 5s
      retries: 24
    networks:
      qaira-data:
        aliases:
          - postgres

  api:
    image: ${API_IMAGE}
    container_name: qaira-api-isolated
    hostname: qaira-api
    ports:
      - "${API_HOST_PORT}:3000"
    environment:
      DATABASE_URL: \${DATABASE_URL:-postgresql://qaira:qaira@postgres:5432/qaira}
      SESSION_SECRET: \${SESSION_SECRET:-qaira-dev-secret}
      CORS_ORIGIN: \${CORS_ORIGIN:-http://localhost:${FRONTEND_HOST_PORT},http://127.0.0.1:${FRONTEND_HOST_PORT}}
      TESTENGINE_CALLBACK_SECRET: \${TESTENGINE_CALLBACK_SECRET:-qaira-testengine-dev-secret}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      qaira-data: {}
      qaira-app:
        aliases:
          - api
    restart: unless-stopped

  frontend:
    image: ${FRONTEND_IMAGE}
    container_name: qaira-frontend-isolated
    hostname: qaira-frontend
    ports:
      - "${FRONTEND_HOST_PORT}:80"
    environment:
      QAIRA_API_BASE_URL: \${QAIRA_API_BASE_URL:-/api}
    depends_on:
      - api
    networks:
      qaira-app:
        aliases:
          - frontend
    restart: unless-stopped

  selenium:
    image: selenium/standalone-chromium:latest
    container_name: qaira-selenium-isolated
    hostname: qaira-selenium
    shm_size: 2gb
    ports:
      - "${SELENIUM_HOST_PORT}:4444"
      - "${SELENIUM_VNC_HOST_PORT}:7900"
    environment:
      SE_NODE_MAX_SESSIONS: \${SE_NODE_MAX_SESSIONS:-4}
      SE_NODE_OVERRIDE_MAX_SESSIONS: "true"
      SE_START_XVFB: "true"
    networks:
      qaira-engine:
        aliases:
          - selenium

  testengine:
    image: ${TESTENGINE_IMAGE}
    container_name: qaira-testengine-isolated
    hostname: qaira-testengine
    ports:
      - "${TESTENGINE_API_HOST_PORT}:4301"
    environment:
      PORT: 4301
      QAIRA_API_BASE_URL: \${QAIRA_API_BASE_URL:-http://api:3000}
      QAIRA_TESTENGINE_SECRET: \${QAIRA_TESTENGINE_SECRET:-qaira-testengine-dev-secret}
      SELENIUM_GRID_URL: \${SELENIUM_GRID_URL:-http://selenium:4444/wd/hub}
      TESTENGINE_POLL_CONCURRENCY: \${TESTENGINE_POLL_CONCURRENCY:-4}
      TESTENGINE_WORKER_CLASS: \${TESTENGINE_WORKER_CLASS:-hybrid}
      ARTIFACT_ROOT: /artifacts
    volumes:
      - qaira-isolated-artifacts:/artifacts
    depends_on:
      - api
      - selenium
    networks:
      qaira-app: {}
      qaira-engine:
        aliases:
          - testengine
    restart: unless-stopped

  mobile-engine:
    build:
      context: ${ROOT_DIR}/local-run/mobile-engine
    container_name: qaira-mobile-engine-isolated
    hostname: qaira-mobile-engine
    ports:
      - "${MOBILE_ENGINE_HOST_PORT}:4312"
    environment:
      PORT: 4312
      APPIUM_SERVER_URL: \${APPIUM_SERVER_URL:-http://host.docker.internal:4723}
      QAIRA_API_BASE_URL: \${QAIRA_API_BASE_URL:-http://api:3000}
    networks:
      qaira-app: {}
      qaira-engine:
        aliases:
          - mobile-engine
    restart: unless-stopped

networks:
  qaira-data:
    driver: bridge
  qaira-app:
    driver: bridge
  qaira-engine:
    driver: bridge

volumes:
  qaira-isolated-postgres:
  qaira-isolated-artifacts:
YAML
}

write_k8s() {
  cat > "${K8S_FILE}" <<YAML
apiVersion: v1
kind: Namespace
metadata:
  name: qaira-isolated
---
apiVersion: v1
kind: Secret
metadata:
  name: qaira-secrets
  namespace: qaira-isolated
stringData:
  postgres-password: "${POSTGRES_PASSWORD:-qaira}"
  session-secret: "${SESSION_SECRET:-qaira-dev-secret}"
  testengine-secret: "${QAIRA_TESTENGINE_SECRET:-qaira-testengine-dev-secret}"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: qaira-isolated
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
              value: qaira
            - name: POSTGRES_USER
              value: qaira
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: qaira-secrets
                  key: postgres-password
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: qaira-isolated
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
  namespace: qaira-isolated
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
              value: postgresql://qaira:qaira@postgres:5432/qaira
            - name: SESSION_SECRET
              valueFrom:
                secretKeyRef:
                  name: qaira-secrets
                  key: session-secret
            - name: TESTENGINE_CALLBACK_SECRET
              valueFrom:
                secretKeyRef:
                  name: qaira-secrets
                  key: testengine-secret
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: qaira-isolated
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
  namespace: qaira-isolated
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
            - name: QAIRA_API_BASE_URL
              value: http://api:3000
            - name: QAIRA_TESTENGINE_SECRET
              valueFrom:
                secretKeyRef:
                  name: qaira-secrets
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
  namespace: qaira-isolated
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
  namespace: qaira-isolated
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
  namespace: qaira-isolated
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
  namespace: qaira-isolated
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
            - name: QAIRA_API_BASE_URL
              value: /api
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: qaira-isolated
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

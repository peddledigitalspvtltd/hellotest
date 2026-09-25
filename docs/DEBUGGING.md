# Debugging HelloTest Locally

This workspace now includes checked-in VS Code debugger configs in [.vscode/launch.json](/Users/jayarajumetta/MJ/hellotest/.vscode/launch.json:1) and supporting tasks in [.vscode/tasks.json](/Users/jayarajumetta/MJ/hellotest/.vscode/tasks.json:1).

## What You Can Launch

- `Full Stack Debug`
  - starts local Postgres with Docker
  - launches the backend API on `http://localhost:3000`
  - launches the Test Engine on `http://localhost:4301`
  - starts Vite and opens the frontend on `http://localhost:5173`
- `API + Test Engine Debug`
  - launches just the backend API and Test Engine
- `Backend API (Attach 9230)` / `Test Engine (Attach 9231)`
  - attach to already running local processes if you started them manually with `--inspect`

## Local Assumptions

- Docker is available so the `postgres:up` task can run `backend/docker-compose.yml`.
- The backend debugger uses the local Postgres defaults from the repo:
  - database: `hellotest`
  - user: `hellotest`
  - password: `hellotest`
  - port: `5432`
- The Test Engine writes local artifacts under `testengine/backend/.artifacts`.

If your local DB settings differ, update the backend environment block in [.vscode/launch.json](/Users/jayarajumetta/MJ/hellotest/.vscode/launch.json:4).

## Recommended Flow For Engine Debugging

1. Run `Full Stack Debug` from VS Code.
2. In HelloTest, make sure the Test Engine integration points to:
   - base URL: `http://localhost:4301`
   - callback URL: `http://localhost:3000/api/testengine/callbacks/runs`
3. Start an execution from the frontend.
4. Put breakpoints in these spots depending on what you want to inspect:
   - frontend trigger/polling: [frontend/src/pages/ExecutionsPage.tsx](/Users/jayarajumetta/MJ/hellotest/frontend/src/pages/ExecutionsPage.tsx:1)
   - backend dispatch to engine: [backend/api/src/services/testEngineDispatch.service.js](/Users/jayarajumetta/MJ/hellotest/backend/api/src/services/testEngineDispatch.service.js:1)
   - backend callback handling: [backend/api/src/services/testEngineCallback.service.js](/Users/jayarajumetta/MJ/hellotest/backend/api/src/services/testEngineCallback.service.js:1)
   - engine execution/runtime: [testengine/backend/src/lib/executor.ts](/Users/jayarajumetta/MJ/hellotest/testengine/backend/src/lib/executor.ts:1)

## Notes

- The frontend debugger launches Chrome against the Vite dev server with source maps enabled.
- The backend and Test Engine both run in watch mode, so edits restart automatically while keeping the debug loop local.
- If you already have the frontend dev server running on `5173`, stop it before launching the `Frontend` config so the background task does not collide on the port.

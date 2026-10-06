# Attach to the running local stack

1. Run `TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache` once.
2. In VS Code, select **Local Docker: Chatbot UI + Backend**, then F5.
3. Sign in at the launched `http://localhost:8080`, open Ask HelloTest and send a message.

F5 automatically runs the attachment task. No separate script command is needed.
Node and Docker must be on your host PATH; local npm installs are not required.

## Service scripts

For terminal use, run `./scripts/debug/chatbot.sh` (leave the terminal open), then use a Node attach configuration on `127.0.0.1:9240` with `localRoot` set to the repository and `remoteRoot` to `/app`. The checked-in profiles already run the tunnel themselves; stop a manual tunnel before using them.

| Script | Existing process | Host inspector port |
| --- | --- | --- |
| `platform.sh`, `testing.sh`, `knowledge.sh`, `manual.sh`, `dashboard.sh`, `automation.sh`, `agentic.sh`, `chatbot.sh`, `ai.sh`, `trace.sh`, `integration.sh` | Combined local API | 9240 |
| `testengine-api-worker.sh` | API execution worker | 9241 |
| `testengine-web-worker.sh` | Web execution worker | 9242 |
| `testengine-android-worker.sh` | Android execution worker | 9243 |
| `mobile-engine.sh` | Mobile provider | 9244 |

All capability scripts target the same API. Use one API tunnel at a time.
For a worker replica other than 1, use e.g. `./scripts/debug/testengine-web-worker.sh 2` and attach manually on 9242; the F5 profiles select replica 1. The tunnel verifies Compose labels and selects only this repository's local stack.

The script enables Node's inspector with SIGUSR1 and forwards inspector traffic through `docker exec`. This works with existing containers whose inspector port was not published, including Docker Desktop on macOS. Application code and HTTP ports stay in the same process. The tunnel only listens on host loopback.

Stop a standalone tunnel with Ctrl+C. For F5 tasks, use **Terminal → Terminate Task** after stopping the debugger. The inspector remains enabled inside the container until that process exits; its port remains unpublished. When the API container is recreated by a later normal build, stop the old tunnel and start debugging again.

Local UI source maps are included by the normal build command. An image built before this change needs that normal build once to support original TSX breakpoints. Production Docker builds leave UI source maps off by default. Worker builds include TypeScript source maps; if they predate this change, rebuild normally for original `.ts` breakpoints. Changing backend source still needs the normal build command to update copied image code.

If you changed `FRONTEND_PORT`, update the **Local Docker: UI** URL in `.vscode/launch.json`. A missing container or unreachable Docker daemon produces an error without starting services.

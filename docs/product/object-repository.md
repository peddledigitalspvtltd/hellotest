# Object Repository browser inspection

Object Repository offers two explicit session choices. A remote session is recommended until the user's local agent has answered an authenticated readiness check. Cloud users do not need a local browser installation for remote inspection.

## Remote browser

The frontend creates a browser through `POST /repository-inspection/sessions`. The API selects the project's configured active Test Engine integration. It never accepts a client-supplied engine URL. The integration's base URL must be reachable **from the API server**, for example `http://testengine:4301` in the packaged Docker stack.

The API returns app-relative session/live URLs. All navigation, tabs, screenshot streams, capture, validation and close requests travel through the API. The reverse proxy's `/api` prefix is preserved. No Test Engine loopback hostname, live token or shared secret is returned to the frontend.

An encrypted, two-hour capability authorizes one browser session and carries the originating login. Each request revalidates that login, current user, project membership, `automation.repository.manage`, and its feature flags. The parent app and iframe can use this capability without placing the user's bearer token in a URL. Tampered, expired, cross-user and cross-session capabilities are rejected. API-key sessions cannot create inspection browsers.

Every inspector gets a fresh browser context. Protected sessions cannot be listed or controlled through unauthenticated Test Engine routes. Closing the dialog stops the session; abandoned sessions stop after the existing inactivity timeout. Test Engine shutdown closes all recorder contexts. `RECORDER_MAX_INSPECTION_SESSIONS` bounds simultaneous inspection sessions per worker (default 6).

The packaged Test Engine HAProxy configuration uses an affinity cookie. The API retains and replays that cookie inside the encrypted session capability, so a session continues on its original worker. Other multi-worker ingress configurations also need sticky session routing for recorder requests. Worker restarts close their browsers; reopen inspection to recover.

Remote inspection accepts HTTP(S) targets and checks initial navigation and explicit navigation against private network addresses. Its per-browser egress proxy validates and pins each connection to its resolved address, including redirects and WebSocket/TLS tunnels; service workers and non-proxied WebRTC UDP are disabled. Use a local agent for private applications. Administrators can allow exact internal hostnames with `RECORDER_ALLOWED_PRIVATE_HOSTS` on the Test Engine; do not expose metadata or infrastructure endpoints in this allowlist. Apply the normal network egress controls for browser workers as well.

### Resolving startup DNS errors

`INSPECTION_DNS_FAILED` refers to the **Page URL hostname**, not the HelloTest API endpoint. Running HelloTest at `localhost:8080` does not make a remote Test Engine browser a local session. The demo project uses `staging.example.test`; replace this illustrative address with the application's real URL. The Live builder exposes Page URL before startup and an **Open blank browser** action for either session type. Editing this address does not update the repository until the screen is saved.

For local sessions, pair the local agent and select **Local session**. It uses that computer's DNS and VPN. For remote sessions, the target must resolve and be reachable from the Test Engine worker. Container `localhost` refers to the container; a host application needs a reachable host address (such as `host.docker.internal` where supported) and an exact private-host allowlist entry. The allowlist grants access; it does not create a DNS record. Configure internal DNS/host mappings on the worker or use a local session for private applications.

Temporary DNS errors retry up to three times, with a five-second deadline per attempt, and return retryable HTTP 503 if resolution still fails. Unknown hostnames return HTTP 400 with the failing hostname and correction guidance. Paths, queries and credentials are omitted from DNS diagnostics. The selected session type is retained after a failed start.

## Local agent

Click **Local agent** in Object Repository to generate a paired setup command. The user needs Node.js 20 or newer and npm; no repository checkout or private npm package is required. The authenticated download link expires after ten minutes. The command installs pinned Fastify and Playwright versions plus Chromium beneath `~/.hellotest/inspection-agent/`, then starts the recorder on `127.0.0.1:4311`. Keep that terminal open; Ctrl+C stops the agent and its sessions.

The API includes the compiled recorder runtime, so local installation and inspection work even when no remote Test Engine is configured or reachable. Installer retrieval does not expose shared engine credentials. Linux machines also need the normal Chromium OS dependencies and a graphical desktop for the visible local browser.

The browser generates the local pairing secret; setup embeds it with that workspace's exact origin. The agent accepts that origin and requires `X-HelloTest-Agent-Token` for creation/readiness. Live view requests use their separate session token. A known development engine secret cannot bypass local pairing. The connected indicator requires the correct service/protocol, pairing, and installed Chromium executable. Checking an API server's localhost is never treated as evidence of the user's computer being connected.

The browser only probes its loopback agent after the user opens local setup or chooses local mode. If the browser requests local-network permission, allow it to connect; otherwise use the remote session. If port 4311 is already occupied by another agent, stop that process and rerun the command. The command pairs this browser; another browser needs its own setup command.

## Deployment and checks

Deploy the updated API, frontend, Test Engine and gateway configuration together. Keep existing production shared-secret validation and engine CORS restrictions. Opening a remote inspector does not require widening Test Engine CORS or enabling the separate recorder/execution features.

After editing the recorder or inspection security modules, regenerate the API's compressed runtime with `npm --prefix testengine/backend run package:inspection-agent`. The Test Engine test suite verifies that the packaged local agent matches the compiled sources; both API Docker build paths include this asset automatically.

Checks:

```sh
node --test services/platform/backend/test/repositoryInspection.test.js
npm --prefix testengine/backend test
node --test testengine/backend/test/browser/repositoryInspectionFlow.test.mjs
```

The last check uses installed Playwright Chromium, starts isolated fixture servers, proves a real iframe stream through the `/api` proxy, validates a captured locator, denies direct unauthenticated access and closes the browser.

## Locator review

The Local agent indicator sits at the right of the page heading. Screen and field selection keeps the URL synchronized; changing screens clears the previous field link. Field configuration separates Locators, Evidence, AI Meaning and Healing. Healing combines readiness, suggestion generation and the editable proposal review.

Generating a proposal never updates the saved field. Applying it requires repository management permission and the original locator for a conflict check. The previous locator remains a fallback, the reviewer and before/after values are recorded, and a changed locator needs fresh validation. Remote startup failures clear the failed session so the browser can be opened again.

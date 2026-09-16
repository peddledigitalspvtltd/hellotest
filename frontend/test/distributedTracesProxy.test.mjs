import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

test("distributed traces proxy forwards UI, assets, and API paths without the browser prefix", async () => {
  const requests = [];
  const upstream = createHttpServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/api/services?service=hello%20test") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ data: ["hellotest-api"] }));
    } else if (request.url === "/static/index.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end("window.jaegerLoaded = true;");
    } else if (request.url === "/" || request.url === "/search?service=hellotest-api") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><title>Jaeger UI</title><script src="./static/index.js"></script>');
    } else {
      response.writeHead(404);
      response.end("Unknown Jaeger route");
    }
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  const previousTarget = process.env.VITE_DEV_JAEGER_PROXY_TARGET;
  process.env.VITE_DEV_JAEGER_PROXY_TARGET = `http://127.0.0.1:${upstream.address().port}`;
  let frontend;
  try {
    frontend = await createServer({
      root: fileURLToPath(new URL("..", import.meta.url)),
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      appType: "custom",
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    await frontend.listen();
    const origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;

    for (const path of ["/jaeger/", "/jaeger/search?service=hellotest-api"]) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<title>Jaeger UI<\/title>/);
    }
    const services = await fetch(`${origin}/jaeger/api/services?service=hello%20test`);
    assert.equal(services.status, 200);
    assert.match(services.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await services.json(), { data: ["hellotest-api"] });
    const script = await fetch(`${origin}/jaeger/static/index.js`);
    assert.equal(script.status, 200);
    assert.equal(await script.text(), "window.jaegerLoaded = true;");
    assert.deepEqual(requests, ["/", "/search?service=hellotest-api", "/api/services?service=hello%20test", "/static/index.js"]);

    await fetch(`${origin}/jaeger-other`);
    assert.equal(requests.length, 4, "only the Jaeger namespace should reach the trace service");

    await new Promise((resolve) => upstream.close(resolve));
    const unavailable = await fetch(`${origin}/jaeger/`);
    assert.equal(unavailable.status, 500, "an unavailable Jaeger must never fall back to the application HTML");
    assert.doesNotMatch(await unavailable.text(), /<html|<div id="root"/i);
  } finally {
    if (previousTarget === undefined) delete process.env.VITE_DEV_JAEGER_PROXY_TARGET;
    else process.env.VITE_DEV_JAEGER_PROXY_TARGET = previousTarget;
    await frontend?.close();
    if (upstream.listening) await new Promise((resolve) => upstream.close(resolve));
  }
});

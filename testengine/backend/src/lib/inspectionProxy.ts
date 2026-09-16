import http from "node:http";
import net, { type Socket } from "node:net";
import { resolveRemoteInspectionTarget } from "./inspectionSecurity.js";

/** Browser egress is pinned to the address we checked, including redirects and
 * WebSocket tunnels. A page cannot re-resolve an allowed hostname to an internal
 * address between policy validation and connection. */
export async function createInspectionProxy() {
  let closed = false;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(60_000, () => socket.destroy());
    return socket;
  };
  const server = http.createServer(async (request, reply) => {
    try {
      const url = new URL(request.url || "");
      if (url.protocol !== "http:") throw new Error("HTTP proxy requires an absolute HTTP URL.");
      const address = await resolveRemoteInspectionTarget(url.href);
      if (closed || reply.destroyed) return;
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request({ hostname: address, port: url.port || 80, method: request.method, path: `${url.pathname}${url.search}`, headers }, response => {
        reply.writeHead(response.statusCode || 502, response.headers);
        response.pipe(reply);
      });
      upstream.on("socket", track);
      upstream.on("error", () => { if (!reply.headersSent) reply.writeHead(502); reply.end("Remote browser destination is unavailable."); });
      request.on("aborted", () => upstream.destroy());
      reply.on("close", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      reply.writeHead(403, { "content-type": "text/plain" });
      reply.end("Remote inspection cannot access this destination. Use a local session for private applications.");
    }
  });
  const tunnel = async (request: http.IncomingMessage, incoming: Socket, head: Buffer, connect: boolean) => {
    try {
      const url = new URL(connect ? `https://${request.url}` : String(request.url || ""));
      if (!connect && url.protocol !== "ws:" && url.protocol !== "http:") throw new Error("Invalid WebSocket target.");
      const address = await resolveRemoteInspectionTarget(url.href.replace(/^ws:/, "http:"));
      if (closed || incoming.destroyed) return;
      const upstream = track(net.connect({ host: address, port: Number(url.port || (connect ? 443 : 80)) }));
      upstream.once("connect", () => {
        if (connect) incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        else {
          const headers: http.OutgoingHttpHeaders = { ...request.headers, host: url.host };
          delete headers["proxy-authorization"];
          delete headers["proxy-connection"];
          upstream.write(`${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
        }
        if (head.length) upstream.write(head);
        incoming.pipe(upstream); upstream.pipe(incoming);
      });
      upstream.once("error", () => incoming.destroy());
      incoming.once("error", () => upstream.destroy());
      incoming.once("close", () => upstream.destroy());
    } catch {
      incoming.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    }
  };
  server.on("connection", track);
  server.on("connect", (req, socket, head) => { void tunnel(req, socket as Socket, head, true); });
  server.on("upgrade", (req, socket, head) => { void tunnel(req, socket as Socket, head, false); });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address() as net.AddressInfo;
  return {
    server: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => { closed = true; for (const socket of sockets) socket.destroy(); server.close(() => resolve()); })
  };
}

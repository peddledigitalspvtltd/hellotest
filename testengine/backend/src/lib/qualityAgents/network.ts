import http from "node:http";
import net, { type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { isPrivateInspectionAddress } from "../inspectionSecurity.js";
import { QualityError } from "./contracts.js";

export class QualityNetworkPolicy {
  readonly origins: Set<string>;
  readonly privateHosts: Set<string>;
  private resolved = new Map<string, string>();
  constructor(target: string, environment: NodeJS.ProcessEnv = process.env, private readonly resolver = lookup) {
    this.origins = new Set([new URL(target).origin]);
    for (const value of (environment.QUALITY_AGENT_ALLOWED_ORIGINS || "").split(",").filter(Boolean)) {
      const url = new URL(value.trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new QualityError("QUALITY_POLICY_INVALID", "Configured quality-agent origins must be exact HTTP(S) origins.", 503);
      this.origins.add(url.origin);
    }
    this.privateHosts = new Set((environment.QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS || "").split(",").map(value => value.trim().toLowerCase().replace(/^\[|\]$/g, "")).filter(Boolean));
  }
  allows(value: string) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && this.origins.has(url.origin); } catch { return false; } }
  async resolve(value: string): Promise<string> {
    if (!this.allows(value)) throw new QualityError("QUALITY_ORIGIN_DENIED", "The browser destination is outside the permitted target origins.", 403);
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const cached = this.resolved.get(host); if (cached) return cached;
    const privateAllowed = this.privateHosts.has(host);
    if (!privateAllowed && isPrivateInspectionAddress(host)) throw new QualityError("QUALITY_PRIVATE_TARGET", "Private targets require an administrator to allow this exact QA hostname.", 403);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = net.isIP(host) ? [{ address: host }] : await Promise.race([this.resolver(host, { all: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new QualityError("QUALITY_DNS_TIMEOUT", "Target DNS resolution timed out.", 503)), 3000); timer.unref?.(); })]);
      if (!addresses.length || (!privateAllowed && addresses.some(item => isPrivateInspectionAddress(item.address) || item.address === "255.255.255.255"))) throw new QualityError("QUALITY_PRIVATE_TARGET", "The target DNS records include a private or reserved destination.", 403);
      // Browser egress uses this IP directly; DNS cannot change after validation.
      const address = addresses[0].address;
      this.resolved.set(host, address); return address;
    } catch (error) { if (error instanceof QualityError) throw error; throw new QualityError("QUALITY_DNS_FAILED", "The Test Engine could not resolve the approved target hostname.", 503); }
    finally { if (timer) clearTimeout(timer); }
  }
}

/** An isolated explicit proxy pins every connection to an address checked by the
 * same policy. Redirects, resources, frames and HTTPS tunnels cannot bypass it. */
export async function createQualityProxy(policy: QualityNetworkPolicy) {
  let closed = false;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.setTimeout(30000, () => socket.destroy()); return socket; };
  const server = http.createServer(async (request, reply) => {
    try {
      const url = new URL(request.url || "");
      if (url.protocol !== "http:") throw new Error("Not HTTP");
      const address = await policy.resolve(url.href);
      if (closed || reply.destroyed) return;
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: url.host }; delete headers["proxy-authorization"]; delete headers["proxy-connection"];
      const upstream = http.request({ hostname: address, port: url.port || 80, method: request.method, path: `${url.pathname}${url.search}`, headers }, response => { reply.writeHead(response.statusCode || 502, response.headers); response.pipe(reply); });
      upstream.on("socket", track); upstream.on("error", () => { if (!reply.headersSent) reply.writeHead(502); reply.end("Approved destination unavailable."); });
      request.on("aborted", () => upstream.destroy()); reply.on("close", () => upstream.destroy()); request.pipe(upstream);
    } catch { reply.writeHead(403); reply.end("Browser destination denied by quality-agent policy."); }
  });
  server.on("connection", track);
  server.on("connect", (request, incomingSocket, head) => {
    const incoming = incomingSocket as Socket;
    void (async () => {
      try {
        const url = new URL(`https://${request.url}`); const address = await policy.resolve(url.href);
        if (closed || incoming.destroyed) return;
        const upstream = track(net.connect({ host: address, port: Number(url.port || 443) }));
        upstream.once("connect", () => { incoming.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.length) upstream.write(head); incoming.pipe(upstream); upstream.pipe(incoming); });
        upstream.once("error", () => incoming.destroy()); incoming.once("error", () => upstream.destroy()); incoming.once("close", () => upstream.destroy());
      } catch { incoming.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); }
    })();
  });
  server.on("upgrade", (_, socket) => socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address() as net.AddressInfo;
  return { server: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>(resolve => { closed = true; for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }) };
}

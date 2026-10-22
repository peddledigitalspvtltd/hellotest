import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EngineWebEngineProvider } from "../contracts/hellotest.js";
import { requestEngineService } from "./engineHttpClient.js";
import { resolveTestEngineSharedSecret } from "./testEngineSecurity.js";

type Dependencies = {
  environment?: NodeJS.ProcessEnv;
  resolve?: (hostname: string) => Promise<{ address: string }[]>;
  request?: typeof requestEngineService;
};

/** Gateways can route a viewer to a different replica than the queue worker.
 * Discover only the configured service's peers, and request the exact run.
 * Peer calls are authenticated and local-only, so they cannot form a loop. */
export function createLiveViewPeerReader(dependencies: Dependencies = {}) {
  const environment = dependencies.environment || process.env;
  const resolve = dependencies.resolve || ((hostname: string) => lookup(hostname, { all: true }));
  const request = dependencies.request || requestEngineService;
  const owners = new Map<string, string>();
  let addresses: string[] = [];
  let addressesExpireAt = 0;
  return async (provider: EngineWebEngineProvider, engineRunId: string | undefined): Promise<Buffer | null> => {
    const hostname = String(environment.TESTENGINE_LIVE_PEER_HOST || "").trim();
    if (!hostname || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(hostname) || !engineRunId || engineRunId.length > 255) return null;
    const secret = resolveTestEngineSharedSecret(environment);
    if (!secret.ready || !secret.secret) return null;
    const port = Number(environment.TESTENGINE_LIVE_PEER_PORT || "4301");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (Date.now() >= addressesExpireAt) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Peer lookup timed out")), 1500); });
        let records;
        try { records = await Promise.race([resolve(hostname), timeout]); }
        finally { if (timer) clearTimeout(timer); }
        addresses = [...new Set(records.map(record => record.address).filter(address => isIP(address)))].slice(0, 8);
        addressesExpireAt = Date.now() + 5000;
      } catch { return null; }
    }
    const key = `${engineRunId}:${provider}`;
    const read = async (address: string) => {
      const host = isIP(address) === 6 ? `[${address}]` : address;
      const image = await request<Buffer>({
        url: `http://${host}:${port}/api/v1/live-session/screenshot?provider=${provider}&run_id=${encodeURIComponent(engineRunId)}&local_only=1`,
        service: "Test Engine live view peer", timeoutMs: 1500, maxResponseBytes: 8 * 1024 * 1024, responseType: "buffer",
        init: { headers: { "x-hellotest-testengine-secret": secret.secret as string, "cache-control": "no-store" } }
      });
      if (!image?.length) throw new Error("This peer does not own the browser");
      if (owners.size >= 2000) owners.delete(owners.keys().next().value as string);
      owners.set(key, address);
      return image;
    };
    const owner = owners.get(key);
    if (owner && addresses.includes(owner)) {
      try { return await read(owner); }
      catch { owners.delete(key); }
    }
    try { return await Promise.any(addresses.filter(address => address !== owner).map(read)); }
    catch { return null; }
  };
}

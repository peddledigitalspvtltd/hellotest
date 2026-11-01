import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export class InspectionTargetError extends Error {
  constructor(public readonly code: "INSPECTION_URL_INVALID" | "INSPECTION_PRIVATE_TARGET" | "INSPECTION_DNS_FAILED", message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "InspectionTargetError";
  }
  get retryable() { return this.statusCode === 503; }
}

async function lookupInspectionHost(host: string, resolver: typeof lookup) {
  for (let attempt = 0; ; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        resolver(host, { all: true }),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })), 5_000); })
      ]);
    } catch (failure) {
      const transient = ["EAI_AGAIN", "ETIMEOUT", "ETIMEDOUT", "ESERVFAIL", "ECONNREFUSED"].includes(String((failure as NodeJS.ErrnoException)?.code));
      if (transient && attempt < 2) { await delay(200 * (attempt + 1)); continue; }
      const message = transient
        ? `The Test Engine's DNS service could not resolve "${host}" after three attempts. Check the engine's DNS or VPN connection, then retry.`
        : `The remote Test Engine could not resolve "${host}". Check Page URL, or clear it to open a blank browser. Demo addresses such as staging.example.test must be replaced with your application's URL. For a private application, connect a local session or configure this hostname in the engine's DNS.`;
      throw new InspectionTargetError("INSPECTION_DNS_FAILED", message, transient ? 503 : 400);
    } finally { if (timeout) clearTimeout(timeout); }
  }
}

export function isPrivateInspectionAddress(value: string): boolean {
  const host = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;
  if (host.includes(":")) {
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice(7);
      if (mapped.includes(".")) return isPrivateInspectionAddress(mapped);
      const parts = mapped.split(":");
      if (parts.length === 2) return isPrivateInspectionAddress(`${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`);
    }
    return host === "::" || host === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(host);
  }
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

/** An administrator may route one exact origin to a local network endpoint.
 * Browser URLs/Host headers stay unchanged; mappings never come from a tool,
 * prompt, request body or page. No wildcard host/port grants are accepted. */
function configuredOriginTarget(origin: string): URL | null {
  const raw = process.env.RECORDER_TARGET_ORIGIN_ALIASES;
  if (!raw?.trim()) return null;
  let entries: Record<string, unknown>;
  try {
    entries = JSON.parse(raw);
    if (!entries || typeof entries !== "object" || Array.isArray(entries) || raw.length > 4096 || Object.keys(entries).length > 8) throw new Error();
    for (const [source, target] of Object.entries(entries)) {
      const from = new URL(source), to = new URL(String(target));
      if (typeof target !== "string" || !["http:", "https:"].includes(from.protocol) || from.protocol !== to.protocol
        || from.origin !== source || to.origin !== target || from.username || from.password || to.username || to.password) throw new Error();
    }
  } catch { throw new InspectionTargetError("INSPECTION_URL_INVALID", "The configured inspection origin routes are invalid. Ask an administrator to correct the exact origin mapping."); }
  return Object.hasOwn(entries, origin) ? new URL(String(entries[origin])) : null;
}

export async function resolveRemoteInspectionEndpoint(value: string, resolver = lookup, pairedPrivateOrigin?: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new InspectionTargetError("INSPECTION_URL_INVALID", "Enter an HTTP or HTTPS URL without embedded credentials."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new InspectionTargetError("INSPECTION_URL_INVALID", "Inspection supports HTTP(S) URLs without embedded credentials.");
  const mapped = configuredOriginTarget(url.origin), endpoint = mapped || url;
  const host = endpoint.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowlisted = (process.env.RECORDER_ALLOWED_PRIVATE_HOSTS || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  const allowedPrivate = Boolean(mapped) || allowlisted.includes(host) || url.origin === pairedPrivateOrigin;
  if (!allowedPrivate && isPrivateInspectionAddress(host)) throw new InspectionTargetError("INSPECTION_PRIVATE_TARGET", "This address is private to the Test Engine. Use a connected local session, or ask an administrator to allow this exact hostname.");
  let addresses: Array<{ address: string }>;
  addresses = isIP(host) ? [{ address: host }] : await lookupInspectionHost(host, resolver);
  if (!addresses.length) throw new InspectionTargetError("INSPECTION_DNS_FAILED", `The remote Test Engine found no DNS addresses for "${host}". Check Page URL or use a connected local session for a private application.`);
  if (!allowedPrivate && addresses.some(item => isPrivateInspectionAddress(item.address))) throw new InspectionTargetError("INSPECTION_PRIVATE_TARGET", "The remote inspection destination resolves to a private network. Use a local session for private applications.");
  return { address: addresses[0].address, port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)) };
}

export async function resolveRemoteInspectionTarget(value: string, resolver = lookup) {
  return (await resolveRemoteInspectionEndpoint(value, resolver)).address;
}

export async function assertRemoteInspectionUrl(value: string, resolver = lookup) {
  await resolveRemoteInspectionTarget(value, resolver);
}

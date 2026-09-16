import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export function isPrivateInspectionAddress(value) {
    const host = value.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal")
        return true;
    if (host.includes(":")) {
        if (host.startsWith("::ffff:")) {
            const mapped = host.slice(7);
            if (mapped.includes("."))
                return isPrivateInspectionAddress(mapped);
            const parts = mapped.split(":");
            if (parts.length === 2)
                return isPrivateInspectionAddress(`${parseInt(parts[0], 16) >> 8}.${parseInt(parts[0], 16) & 255}.${parseInt(parts[1], 16) >> 8}.${parseInt(parts[1], 16) & 255}`);
        }
        return host === "::" || host === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(host);
    }
    if (isIP(host) !== 4)
        return false;
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
export async function resolveRemoteInspectionTarget(value, resolver = lookup) {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Inspection supports HTTP(S) URLs without embedded credentials.");
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const allowlisted = (process.env.RECORDER_ALLOWED_PRIVATE_HOSTS || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    const allowedPrivate = allowlisted.includes(host);
    if (!allowedPrivate && isPrivateInspectionAddress(host))
        throw new Error("This address is private to the Test Engine. Use a connected local session, or ask an administrator to allow this exact hostname.");
    const addresses = isIP(host) ? [{ address: host }] : await resolver(host, { all: true });
    if (!addresses.length || (!allowedPrivate && addresses.some(item => isPrivateInspectionAddress(item.address))))
        throw new Error("The remote inspection destination resolves to a private network. Use a local session for private applications.");
    return addresses[0].address;
}
export async function assertRemoteInspectionUrl(value, resolver = lookup) {
    await resolveRemoteInspectionTarget(value, resolver);
}

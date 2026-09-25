import type { ComponentType } from "react";
import type { HelloTestService } from "../../services/shared";

type CapabilityModule = { views: Record<string, () => Promise<Record<string, unknown>>> };
type Manifest = { protocol: number; capability: string; version: string; entry: string; styles: string[] };
const modules = new Map<string, Promise<CapabilityModule>>();
const styles = new Map<string, Promise<void>>();

export function capabilityUiUrl(owner: HelloTestService): string | undefined {
  const configured = window.__HELLOTEST_CONFIG__?.CAPABILITY_UI_URLS?.[owner];
  if (configured === undefined) return undefined;
  if (typeof configured !== "string" || !configured.trim()) throw new Error(`${owner} UI is not configured.`);
  const url = new URL(configured, window.location.origin);
  if (url.origin !== window.location.origin || url.username || url.password || !/^https?:$/.test(url.protocol)) {
    throw new Error("Capability interfaces must use the application gateway.");
  }
  return url.href;
}

export function validateCapabilityManifest(value: unknown, owner: string, manifestUrl: string): Manifest {
  const manifest = value as Partial<Manifest> | null;
  if (!manifest || manifest.protocol !== 1 || manifest.capability !== owner || !manifest.version
    || typeof manifest.entry !== "string" || !Array.isArray(manifest.styles)
    || !manifest.styles.every(style => typeof style === "string")) {
    throw new Error(`The ${owner} interface is incompatible with this application. Please contact your administrator.`);
  }
  const base = new URL(".", manifestUrl);
  for (const asset of [manifest.entry, ...manifest.styles]) {
    const url = new URL(asset, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) {
      throw new Error("Invalid capability asset location.");
    }
  }
  return manifest as Manifest;
}

function withDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([operation, new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("This feature took too long to load. Please retry.")), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function loadStyle(url: string) {
  if (styles.has(url)) return styles.get(url)!;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  const promise = withDeadline(new Promise<void>((resolve, reject) => {
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("The feature stylesheet could not be loaded."));
    document.head.appendChild(link);
  }), 20_000).catch(error => { styles.delete(url); link.remove(); throw error; });
  styles.set(url, promise);
  return promise;
}

export async function loadCapabilityView<P>(owner: HelloTestService, view: string,
  local: () => Promise<Record<string, unknown>>): Promise<ComponentType<P>> {
  const manifestUrl = capabilityUiUrl(owner);
  if (!manifestUrl) {
    const module = await local();
    if (!module[view]) throw new Error(`The ${view} interface is unavailable.`);
    return module[view] as ComponentType<P>;
  }
  const key = `${owner}:${manifestUrl}`;
  let loading = modules.get(key);
  if (!loading) {
    loading = (async () => {
      if (window.__HELLOTEST_UI_HOST__?.protocol !== 1) throw new Error("The application interface host is unavailable.");
      const response = await fetch(manifestUrl, { credentials: "same-origin", cache: "no-cache", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`The ${owner} interface is unavailable (${response.status}). Please retry.`);
      const manifest = validateCapabilityManifest(await response.json(), owner, manifestUrl);
      await Promise.all(manifest.styles.map(style => loadStyle(new URL(style, manifestUrl).href)));
      const module = await withDeadline(import(/* @vite-ignore */ new URL(manifest.entry, manifestUrl).href), 30_000);
      if (!module.views || typeof module.views !== "object") throw new Error("The capability release has no interface exports.");
      return module as CapabilityModule;
    })();
    modules.set(key, loading);
    void loading.catch(() => { if (modules.get(key) === loading) modules.delete(key); });
  }
  const module = await loading;
  try {
    if (typeof module.views[view] !== "function") throw new Error(`This release does not provide ${view}.`);
    const loaded = await withDeadline(module.views[view](), 30_000);
    if (!loaded[view]) throw new Error(`The ${view} interface is unavailable.`);
    return loaded[view] as ComponentType<P>;
  } catch (error) {
    // A deployment may have removed an old lazy chunk. Retry must re-read the
    // manifest so a newer release can recover without discarding host state.
    if (modules.get(key) === loading) modules.delete(key);
    throw error;
  }
}

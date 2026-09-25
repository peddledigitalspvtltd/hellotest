import { serviceDefinitions } from "../../services";
import type { HelloTestService } from "../../services/shared";

type ServiceUrlMap = Partial<Record<HelloTestService, string>>;

const environment = import.meta.env as Record<string, string | undefined>;

const trimBase = (value: string) => value.replace(/\/$/, "");

const runtimeServiceUrls = (): ServiceUrlMap => {
  if (typeof window === "undefined") return {};
  const value = window.__HELLOTEST_CONFIG__?.SERVICE_URLS;
  return value && typeof value === "object" ? value : {};
};

export const serviceForPath = (pathname: string): HelloTestService => {
  const path = pathname.split("?", 1)[0];
  return serviceDefinitions.find((service) => service.matches(path))?.id || "manual";
};

export const resolveServiceBase = (pathname: string, fallback: string): string => {
  const service = serviceForPath(pathname);
  const definition = serviceDefinitions.find((entry) => entry.id === service);
  const configured = runtimeServiceUrls()[service] || (definition ? environment[definition.envKey] : undefined);
  return trimBase(configured || fallback);
};

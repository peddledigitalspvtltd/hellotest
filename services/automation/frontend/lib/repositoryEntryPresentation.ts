/** Saved repository identities and labels. Draft fields never change execution bindings. */
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import { repositoryInspectLegacyPageUrl } from "./repositoryInspectSession";

export const formatRunDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function normalizeMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function formatRepositoryDate(value: unknown) {
  const text = normalizeMetadataValue(value);
  if (!text) return "Never validated";
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? text : formatRunDate.format(date);
}

export function getScreenName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.screen_name) || entry.page_key || "Unassigned screen";
}

export function makeRepositoryScreenKey(screenName: string, appTypeId?: string | null) {
  return `${appTypeId || "workspace"}::${screenName}`;
}

export function getRepositoryScreenKey(entry: AutomationLearningCacheEntry) {
  return makeRepositoryScreenKey(getScreenName(entry), entry.app_type_id || (entry.project_id ? `project-${entry.project_id}` : null));
}

export function getObjectName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_name) || entry.locator_intent || "Unnamed object";
}

export function getObjectRole(entry: AutomationLearningCacheEntry) {
  const value = normalizeMetadataValue(entry.metadata?.object_role) || entry.locator_kind || entry.source || "field";
  const parts = value.split(/\s*\/\s*/).filter(Boolean);
  return parts[parts.length - 1] || value;
}

export function splitRepositoryRole(value: string, fallbackTag = "element", fallbackRole = "field") {
  const parts = value.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
  return {
    tag: parts[0] || fallbackTag,
    role: parts[parts.length - 1] || fallbackRole
  };
}

export function getRepositoryScreenUrl(entries: AutomationLearningCacheEntry[]) {
  return entries.find((entry) => entry.page_url)?.page_url || repositoryInspectLegacyPageUrl(entries[0]?.page_key) || "No URL captured";
}

export function isLikelyImageUrl(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:image/");
}

export function toFriendlyElementName(value: string, fallback = "Element") {
  const normalized = value
    .replace(/^text=/i, "")
    .replace(/^[#.]+/, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(click|input|element|field|button|link|label|aria|text|at)\b/gi, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  const tokens = normalized ? normalized.split(/\s+/).slice(0, 4) : [fallback];
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

export function isNoisyRepositoryName(value?: string | null) {
  const normalized = normalizeMetadataValue(value).trim();
  if (!normalized) return true;
  return /\b(click\s*at|scroll|viewport|location|browser|document|window)\b/i.test(normalized) || /\d{3,}/.test(normalized);
}

export function isNonElementRepositoryEntry(entry: AutomationLearningCacheEntry) {
  const locator = String(entry.locator || "").trim().toLowerCase();
  const intent = String(entry.locator_intent || "").trim().toLowerCase();
  const role = getObjectRole(entry).toLowerCase();
  const blockedLocators = new Set(["viewport", "location", "browser.tab", "keyboard", "window", "document", "page"]);
  const blockedIntents = new Set(["scroll", "navigation", "navigate", "goto", "tab", "press"]);
  return isScreenRepositoryRecord(entry) || blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
}

export function isScreenRepositoryRecord(entry: AutomationLearningCacheEntry) {
  return entry.locator_intent === "__screen__" || entry.metadata?.record_kind === "screen" || entry.source === "manual_screen";
}

export function getRepositoryMemberName(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  // Saved names are execution bindings. A locator repair must not rename the
  // member (or change its casing) merely because its CSS selector changed.
  const storedName = normalizeMetadataValue(metadata.object_name) || normalizeMetadataValue(metadata.member_name) || normalizeMetadataValue(metadata.field_name);
  if (storedName) {
    const prefix = `${getScreenName(entry)}.`;
    return storedName.startsWith(prefix) ? storedName.slice(prefix.length) : storedName;
  }
  const locator = String(entry.locator || "");
  const locatorLabel =
    locator.match(/\[(?:aria-label|placeholder|name|data-testid|id)=["']?([^"'\]]+)["']?\]/i)?.[1] ||
    locator.match(/^#([\w-]+)/)?.[1] ||
    locator.match(/^text=(.+)$/i)?.[1] ||
    "";
  const explicit =
    normalizeMetadataValue(metadata.field_name) ||
    normalizeMetadataValue(metadata.member_name) ||
    normalizeMetadataValue(metadata.object_label);
  const objectName = normalizeMetadataValue(metadata.object_name);
  const objectNameValue = isNoisyRepositoryName(objectName) ? "" : objectName;
  const intent = /^(click|fill|change|input|element|field|object|scroll|viewport)$/i.test(entry.locator_intent || "") ? "" : entry.locator_intent;
  const tail = explicit.includes(".") ? explicit.split(".").filter(Boolean).pop() || explicit : explicit;
  const candidates = [locatorLabel, isNoisyRepositoryName(tail) ? "" : tail, objectNameValue, isNoisyRepositoryName(intent) ? "" : intent, locator];
  return toFriendlyElementName(candidates.find((candidate) => candidate && !isNoisyRepositoryName(toFriendlyElementName(candidate))) || "Element");
}

export function getRepositoryHtmlTag(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  const explicit =
    normalizeMetadataValue(metadata.html_tag) ||
    normalizeMetadataValue(metadata.tag_name) ||
    normalizeMetadataValue(metadata.tag) ||
    normalizeMetadataValue(metadata.element_tag);
  const dom = normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html);
  const domTag = dom.match(/<\s*([a-z][a-z0-9-]*)/i)?.[1] || "";
  const locatorTag = String(entry.locator || "").match(/^([a-z][a-z0-9-]*)[#.[\s]/i)?.[1] || "";
  const role = getObjectRole(entry).toLowerCase();

  if (explicit) return explicit.toLowerCase();
  if (domTag) return domTag.toLowerCase();
  if (locatorTag) return locatorTag.toLowerCase();
  if (role.includes("button")) return "button";
  if (role.includes("link")) return "a";
  if (role.includes("select") || role.includes("dropdown")) return "select";
  if (role.includes("textarea")) return "textarea";
  if (role.includes("checkbox") || role.includes("toggle")) return "input";
  if (role.includes("field") || role.includes("textbox") || role.includes("input")) return "input";
  return "element";
}

from __future__ import annotations
from pathlib import Path
from collections import defaultdict
import csv, re, json, os
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg.normalization import normalize_locator_record, is_actionable_locator, safe_str, route_from_logical, is_interactive_facts, locator_has_bad_expression, is_bad_accessible_name

CSV_COLUMNS = [
    "screen_name", "record_type", "page_url", "url_pattern_type", "url_pattern_value",
    "object_name", "object_role", "locator", "locator_kind", "confidence", "source",
    "description", "business_meaning", "target_criteria", "fallback_locators",
    "usage_keywords", "stability_score", "dom_structure", "screenshot_url", "metadata_json"
]

class WebUiArtifactPackagingAgent:
    """Packages WebUI output into runtime artifacts, QAira Object Repository CSV,
    QAira learning-cache import payload, nested JSON, and stable-only Page Object files.

    Contract:
    - Page classes contain only real Playwright locators. No pseudo/TODO locators.
    - CSV follows QAira OR import format: one screen row + field rows per screen.
    - Import payload targets /api/test-cases/automation/learning-cache/import.
    """
    name = "WebUiArtifactPackagingAgent"
    def __init__(self, ctx, logger):
        self.ctx = ctx; self.logger = logger

    def run(self):
        loc_payload = self.ctx.read_json("generated/html_page_locators.json", {"locators": []}) or {"locators": []}
        raw_locators = loc_payload.get("locators", []) if isinstance(loc_payload, dict) else []
        locators = [normalize_locator_record(l) for l in raw_locators if isinstance(l, dict)]
        fields_payload = self.ctx.read_json("generated/form_intelligence.json", {"fields": []}) or {"fields": []}
        fields = fields_payload.get("fields", []) if isinstance(fields_payload, dict) else []

        by_page_all = group_by_page(locators)
        by_page_stable = {page: [l for l in items if is_real_actionable_locator(l)] for page, items in by_page_all.items()}
        by_page_unstable = {page: [l for l in items if not is_real_actionable_locator(l)] for page, items in by_page_all.items()}

        base = Path("generated/webui")
        page_index = []
        class_exports = []
        total_stable = 0; total_unstable = 0
        all_or_entries = []

        for page_key in sorted(by_page_all.keys()):
            all_items = by_page_all[page_key]
            stable_items = by_page_stable.get(page_key, [])
            unstable_items = by_page_unstable.get(page_key, [])
            total_stable += len(stable_items); total_unstable += len(unstable_items)
            slug = unique_slug(safe_slug(page_key or "root"), {p["slug"] for p in page_index})
            screen_name = screen_name_for(page_key, slug)
            class_name = pascal(slug) + "Page"
            page_dir = base / "pages" / slug
            page_fields = [f for f in fields if page_for({"logicalId": f.get("uiElement", "")}) == page_key]

            # Exact QAira Object Repository import shape: screen row first, then stable field rows.
            screen_entry = make_screen_entry(page_key, screen_name)
            field_entries = [make_field_entry(item, page_key, screen_name) for item in stable_items]
            field_entries = [e for e in field_entries if e.get("locator") and e.get("locator") != "__screen__"]
            all_or_entries.append(screen_entry)
            all_or_entries.extend(field_entries)

            payload = {
                "page": page_key,
                "screenName": screen_name,
                "slug": slug,
                "className": class_name,
                "locatorCount": len(all_items),
                "stableLocatorCount": len(stable_items),
                "unstableLocatorCount": len(unstable_items),
                "objectRepositoryEntryCount": 1 + len(field_entries),
                "locators": all_items,
                "stableLocators": stable_items,
                "unstableLocators": unstable_items,
                "objectRepositoryEntries": [screen_entry] + field_entries,
                "fields": page_fields
            }
            json_rel = str(page_dir / "locators.json").replace("\\", "/")
            stable_rel = str(page_dir / "stable-locators.json").replace("\\", "/")
            unstable_rel = str(page_dir / "unstable-locators.json").replace("\\", "/")
            or_rel = str(page_dir / "object-repository-entries.json").replace("\\", "/")
            class_rel = str(page_dir / f"{slug}.page.ts").replace("\\", "/")
            spec_rel = str(page_dir / f"{slug}.spec.ts").replace("\\", "/")
            self.ctx.write_json(json_rel, payload)
            self.ctx.write_json(stable_rel, {"page": page_key, "screenName": screen_name, "count": len(stable_items), "locators": stable_items})
            self.ctx.write_json(unstable_rel, {"page": page_key, "screenName": screen_name, "count": len(unstable_items), "locators": unstable_items, "recommendation":"Excluded from Page Object class and OR import. Add data-testid, role/name, label, or aria-label to promote these locators."})
            self.ctx.write_json(or_rel, {"screen_name": screen_name, "entries": [screen_entry] + field_entries})
            self.ctx.write_text(class_rel, render_page_class(class_name, stable_items, page_key))
            self.ctx.write_text(spec_rel, render_page_spec(class_name, slug, page_key, stable_items))
            page_meta = {
                "page": page_key, "screenName": screen_name, "slug": slug, "className": class_name,
                "locatorCount": len(all_items), "stableLocatorCount": len(stable_items), "unstableLocatorCount": len(unstable_items),
                "objectRepositoryEntryCount": 1 + len(field_entries),
                "interactiveLocatorCount": sum(1 for x in all_items if is_interactive_facts({**(x.get("evidence") or {}), **x})),
                "stableInteractiveLocatorCount": sum(1 for x in stable_items if is_interactive_facts({**(x.get("evidence") or {}), **x})),
                "json": json_rel, "stableJson": stable_rel, "unstableJson": unstable_rel, "objectRepositoryJson": or_rel,
                "classFile": class_rel, "specFile": spec_rel
            }
            page_index.append(page_meta)
            class_exports.append(f"export * from './pages/{slug}/{slug}.page';")

        nested_pages = {}
        for p in page_index:
            page = p["page"]
            nested_pages[page] = {"meta": p, "locators": by_page_all.get(page, []), "stableLocators": by_page_stable.get(page, []), "unstableLocators": by_page_unstable.get(page, [])}
        nested = {"source": "QSG", "pageCount": len(page_index), "locatorCount": len(locators), "stableLocatorCount": total_stable, "unstableLocatorCount": total_unstable, "objectRepositoryEntryCount": len(all_or_entries), "pages": nested_pages}
        self.ctx.write_json("generated/webui/html_page_locators.nested.json", nested)
        self.ctx.write_json("generated/webui/unstable_locators.report.json", {"count": total_unstable, "byPage": {p: len(v) for p, v in by_page_unstable.items()}, "locators": [l for v in by_page_unstable.values() for l in v]})
        self.ctx.write_json("generated/webui/index.json", {"pageCount": len(page_index), "locatorCount": len(locators), "stableLocatorCount": total_stable, "unstableLocatorCount": total_unstable, "objectRepositoryEntryCount": len(all_or_entries), "pages": page_index, "files": {"nested": "generated/webui/html_page_locators.nested.json", "unstableReport":"generated/webui/unstable_locators.report.json", "csv": "generated/webui/html_page_locators.csv", "objectRepositoryCsv":"generated/webui/object_repository_import.csv", "objectRepositoryPayload":"generated/webui/object_repository_import_payload.json", "objectRepositoryCurl":"generated/webui/import-object-repository.curl.sh", "barrel": "generated/webui/pages.ts"}})
        self.ctx.write_text("generated/webui/pages.ts", "// Generated by QAira QRIP. Stable page objects only.\n" + "\n".join(class_exports) + "\n")
        self.write_legacy_csv("generated/webui/html_page_locators.csv", locators)
        self.write_object_repository_csv("generated/webui/object_repository_import.csv", all_or_entries)
        app_type_id = app_type_id_from_config(self.ctx.config)
        payload = {"app_type_id": app_type_id, "import_source": "or_file_import", "entries": all_or_entries}
        self.ctx.write_json("generated/webui/object_repository_import_payload.json", payload)
        batches = chunk_object_repository_entries(all_or_entries, 200)
        batch_manifest = {"batchSizeLimit": 200, "batchCount": len(batches), "totalEntries": len(all_or_entries), "batches": []}
        for idx, batch_entries in enumerate(batches, start=1):
            batch_payload = {"app_type_id": app_type_id, "import_source": "or_file_import", "entries": batch_entries}
            batch_payload_path = f"generated/webui/object_repository_batches/batch-{idx:03d}.json"
            batch_curl_path = f"generated/webui/object_repository_batches/batch-{idx:03d}.curl.sh"
            self.ctx.write_json(batch_payload_path, batch_payload)
            self.ctx.write_text(batch_curl_path, render_or_curl(payload_path=batch_payload_path))
            batch_manifest["batches"].append({"index": idx, "entries": len(batch_entries), "payload": batch_payload_path, "curl": batch_curl_path})
        self.ctx.write_json("generated/webui/object_repository_import_manifest.json", batch_manifest)
        self.ctx.write_text("generated/webui/import-object-repository.curl.sh", render_or_batch_curl(batch_dir="generated/webui/object_repository_batches"))
        self.ctx.write_json("generated/webui/webui_generation_trace.json", {
            "testType": self.ctx.state.get("testType"),
            "inputLocators": "generated/html_page_locators.json",
            "nestedJson": "generated/webui/html_page_locators.nested.json",
            "pageObjects": [p["classFile"] for p in page_index],
            "pageSpecs": [p["specFile"] for p in page_index],
            "csv": "generated/webui/html_page_locators.csv",
            "objectRepositoryCsv": "generated/webui/object_repository_import.csv",
            "objectRepositoryPayload": "generated/webui/object_repository_import_payload.json",
            "objectRepositoryImportManifest": "generated/webui/object_repository_import_manifest.json",
            "objectRepositoryEndpoint": "/api/test-cases/automation/learning-cache/import",
            "pageCount": len(page_index),
            "locatorCount": len(locators),
            "stableLocatorCount": total_stable,
            "unstableLocatorCount": total_unstable,
            "objectRepositoryEntryCount": len(all_or_entries),
            "objectRepositoryBatchCount": len(batches),
            "objectRepositoryBatchSizeLimit": 200,
            "noiseReduction": {"todoLocatorsInPageClasses": 0, "unstablePreservedIn": "generated/webui/unstable_locators.report.json"}
        })
        return AgentResult(self.name, "success" if locators else "partial", 0.95 if locators else 0.35, {"pages": len(page_index), "locators": len(locators), "stable": total_stable, "unstable": total_unstable, "objectRepositoryEntries": len(all_or_entries), "objectRepositoryBatchCount": len(batches), "objectRepositoryBatchSizeLimit": 200}, {"index": "generated/webui/index.json", "nested": "generated/webui/html_page_locators.nested.json", "csv": "generated/webui/html_page_locators.csv", "objectRepositoryCsv":"generated/webui/object_repository_import.csv", "objectRepositoryPayload":"generated/webui/object_repository_import_payload.json", "objectRepositoryManifest":"generated/webui/object_repository_import_manifest.json", "unstable":"generated/webui/unstable_locators.report.json"})

    def write_legacy_csv(self, rel, locators):
        p = self.ctx.out(rel)
        with p.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["page", "logicalId", "file", "line", "tagName", "role", "risk", "actionable", "primaryStrategy", "primaryLocator", "candidateCount"])
            w.writeheader()
            for l in locators:
                l = normalize_locator_record(l)
                c = (l.get("candidates") or [{}])[0]
                w.writerow({
                    "page": page_for(l), "logicalId": l.get("logicalId"), "file": l.get("file"), "line": l.get("line"),
                    "tagName": l.get("tagName"), "role": l.get("role"), "risk": l.get("locatorRisk"), "actionable": is_real_actionable_locator(l),
                    "primaryStrategy": c.get("strategy", ""), "primaryLocator": c.get("locator", ""), "candidateCount": len(l.get("candidates") or [])
                })

    def write_object_repository_csv(self, rel, entries):
        p = self.ctx.out(rel)
        with p.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            w.writeheader()
            for e in entries:
                row = dict(e)
                metadata = row.pop("metadata", {}) or {}
                # Keep structured columns parseable exactly like QAira OR import CSV.
                row["url_pattern_type"] = metadata.get("url_pattern_type", row.get("url_pattern_type", ""))
                row["url_pattern_value"] = metadata.get("url_pattern_value", row.get("url_pattern_value", ""))
                row["target_criteria"] = json.dumps(metadata.get("target_criteria", []), ensure_ascii=False)
                row["fallback_locators"] = json.dumps(metadata.get("fallback_locators", []), ensure_ascii=False)
                row["usage_keywords"] = json.dumps(metadata.get("usage_keywords", []), ensure_ascii=False)
                row["stability_score"] = metadata.get("stability_score", row.get("stability_score", ""))
                row["dom_structure"] = metadata.get("dom_structure", "")
                row["screenshot_url"] = metadata.get("screenshot_url", "")
                row["business_meaning"] = metadata.get("business_meaning", "")
                row["metadata_json"] = json.dumps(metadata, ensure_ascii=False, sort_keys=True)
                w.writerow({k: row.get(k, "") for k in CSV_COLUMNS})

def group_by_page(locators):
    by = defaultdict(list)
    for l in locators:
        l = normalize_locator_record(l)
        by[page_for(l)].append(l)
    return dict(by)

def page_for(locator):
    locator = locator or {}
    ev = locator.get("evidence") or {}
    if ev.get("route"): return safe_str(ev["route"], "/")
    if locator.get("page"): return safe_str(locator.get("page"), "/")
    return route_from_logical(locator.get("logicalId", ""))

def screen_name_for(page, slug=None):
    s = slug or safe_slug(page or "root")
    if s in {"", "root", "home"} and page not in [None, "", "/"]:
        s = safe_slug(page)
    return (s or "home").replace("-", "_")

def safe_slug(s):
    s = str(s or "root").strip("/") or "root"
    if s == "/": s = "root"
    s = re.sub(r"[^A-Za-z0-9_-]+", "-", s).strip("-") or "root"
    return s.lower()

def unique_slug(slug, used):
    base = slug or "root"; out = base; i = 2
    while out in used:
        out = f"{base}-{i}"; i += 1
    return out

def pascal(s):
    return "".join(x[:1].upper() + x[1:] for x in re.split(r"[-_]+", s) if x) or "Root"

def method_name(logical_id, used):
    raw = safe_str(logical_id).split("/")[-1] or "element"
    name = re.sub(r"[^A-Za-z0-9_]+", "_", raw)
    if not name or name[0].isdigit(): name = "el_" + name
    base = name; i = 2
    while name in used:
        name = f"{base}_{i}"; i += 1
    used.add(name)
    return name

def locator_intent_name(l):
    for key in ["name", "label", "text", "testId"]:
        v = safe_str(l.get(key) or (l.get("evidence") or {}).get(key))
        if v:
            return camelize(v)
    return camelize(safe_str(l.get("logicalId")).split("/")[-1] or "element")

def camelize(s):
    parts = re.split(r"[^A-Za-z0-9]+", safe_str(s))
    parts = [p for p in parts if p]
    if not parts: return "element"
    first = parts[0][:1].lower() + parts[0][1:]
    return first + "".join(p[:1].upper() + p[1:] for p in parts[1:])

def strip_page_prefix(locator):
    s = safe_str(locator)
    if s.startswith("this.page."):
        s = s[len("this.page."):]
    if s.startswith("page."):
        s = s[len("page."):]
    return s

def is_real_locator_expression(locator):
    s = safe_str(locator)
    if not s or "TODO" in s or "/*" in s or "page.locator('')" in s or 'page.locator("")' in s:
        return False
    return (s.startswith("page.getBy") or s.startswith("this.page.getBy") or s.startswith("getBy")) and not locator_has_bad_expression(s)

def is_real_actionable_locator(locator):
    locator = normalize_locator_record(locator)
    if not is_actionable_locator(locator):
        return False
    c = (locator.get("candidates") or [{}])[0]
    return is_real_locator_expression(c.get("locator"))

def locator_kind_for(candidate):
    strategy = safe_str(candidate.get("strategy"))
    loc = safe_str(candidate.get("locator"))
    if strategy == "getByRole" or "getByRole" in loc: return "playwright role + name"
    if strategy == "getByLabel" or "getByLabel" in loc: return "playwright label"
    if strategy == "getByTestId" or "getByTestId" in loc: return "playwright test id"
    if strategy == "getByText" or "getByText" in loc: return "playwright text"
    return strategy or "playwright locator"

def object_role_for(locator):
    ev = locator.get("evidence") or {}
    tag = safe_str(locator.get("tagName") or ev.get("tagName") or locator.get("type") or "element")
    role = safe_str(locator.get("role") or ev.get("role") or ev.get("type") or tag)
    return f"{tag} / {role}"

def page_url_for(page):
    return safe_str(page, "/") or "/"

def url_pattern(page):
    p = page_url_for(page)
    if p.startswith("http://") or p.startswith("https://"):
        try:
            from urllib.parse import urlparse
            path = urlparse(p).path or "/"
            return "endsWith", path
        except Exception:
            return "contains", p
    if p.startswith("/"):
        return "endsWith", p
    return "contains", p

def make_screen_entry(page, screen_name):
    pattern_type, pattern_value = url_pattern(page)
    return {
        "screen_name": screen_name,
        "record_type": "screen",
        "page_url": page_url_for(page),
        "page_key": screen_name,
        "locator_intent": "__screen__",
        "locator": "__screen__",
        "locator_kind": "screen",
        "confidence": 0.8,
        "source": "qaira_repository_agent",
        "object_name": "__screen__",
        "object_role": "screen",
        "description": "Screen extracted from repository semantic graph.",
        "metadata": {
            "url_pattern_type": pattern_type,
            "url_pattern_value": pattern_value,
            "target_criteria": [],
            "fallback_locators": [],
            "usage_keywords": [],
            "stability_score": 0.8,
            "record_kind": "screen",
            "screen_name": screen_name
        }
    }

def make_field_entry(locator, page, screen_name):
    locator = normalize_locator_record(locator)
    candidates = [c for c in locator.get("candidates", []) if is_real_locator_expression(c.get("locator"))]
    primary = candidates[0] if candidates else {}
    primary_locator = strip_page_prefix(primary.get("locator"))
    intent = locator_intent_name(locator)
    pattern_type, pattern_value = url_pattern(page)
    ev = locator.get("evidence") or {}
    fallback = []
    for c in candidates[1:]:
        fallback.append({
            "locator": strip_page_prefix(c.get("locator")),
            "strategy": safe_str(c.get("strategy") or locator_kind_for(c)),
            "confidenceScore": float(c.get("confidence", c.get("confidenceScore", 0.7)) or 0.7),
            "lastValidatedStatus": "pending"
        })
    confidence = float(primary.get("confidence", primary.get("confidenceScore", locator.get("confidence", 0.8))) or 0.8)
    description = f"{intent} captured from repository semantic graph."
    return {
        "screen_name": screen_name,
        "record_type": "field",
        "page_url": page_url_for(page),
        "page_key": screen_name,
        "locator_intent": intent,
        "locator": primary_locator,
        "locator_kind": locator_kind_for(primary),
        "confidence": round(confidence, 3),
        "source": "qaira_repository_agent",
        "object_name": intent,
        "object_role": object_role_for(locator),
        "description": description,
        "metadata": {
            "url_pattern_type": pattern_type,
            "url_pattern_value": pattern_value,
            "description": description,
            "target_criteria": [f"Primary locator: {primary_locator}", f"Locator kind: {locator_kind_for(primary)}"],
            "fallback_locators": fallback,
            "usage_keywords": [],
            "stability_score": round(confidence, 3),
            "dom_structure": safe_str(ev.get("dom") or ev.get("dom_structure") or locator.get("dom_structure")),
            "screenshot_url": safe_str(ev.get("screenshot_url") or locator.get("screenshot_url")),
            "business_meaning": safe_str(locator.get("businessMeaning") or ev.get("businessMeaning")),
            "object_name": intent,
            "object_role": object_role_for(locator),
            "screen_name": screen_name,
            "record_kind": "field",
            "logical_id": locator.get("logicalId"),
            "repository_file": locator.get("file"),
            "repository_line": locator.get("line")
        }
    }

def render_page_class(class_name, locators, page):
    lines = [
        "import type { Page, Locator } from '@playwright/test';",
        "",
        "// Generated by QAira QRIP Locator Agent.",
        "// Contains only stable/actionable locators. Unstable candidates are written to unstable-locators.json.",
        f"// Page: {page}",
        f"export class {class_name} {{",
        "  constructor(private readonly page: Page) {}",
        ""
    ]
    used = set()
    for l in locators:
        if not is_real_actionable_locator(l):
            continue
        m = method_name(l.get("logicalId", "element"), used)
        c = (l.get("candidates") or [{}])[0]
        loc = safe_str(c.get("locator"))
        if not is_real_locator_expression(loc):
            continue
        loc = loc.replace("page.", "this.page.", 1)
        lines.append(f"  get {m}(): Locator {{")
        lines.append(f"    return {loc};")
        lines.append("  }")
        lines.append("")
    if not used:
        lines.append("  // No stable/actionable locators were found for this page yet.")
        lines.append("  // Add data-testid, labels, or accessible names, then rerun QAira.")
        lines.append("")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)

def render_page_spec(class_name, slug, page, locators):
    stable = [l for l in locators if is_real_actionable_locator(l)]
    lines = [
        "import { test, expect } from '@playwright/test';",
        f"import {{ {class_name} }} from './{slug}.page';",
        "",
        f"test.describe('{page} - QAira generated stable locator smoke tests', () => {{",
        "  test.beforeEach(async ({ page }) => {",
        f"    await page.goto(process.env.BASE_URL || '{page}');",
        "  });",
        "",
        "  test('stable generated locators should attach', async ({ page }) => {",
        f"    const screen = new {class_name}(page);"
    ]
    used = set()
    if not stable:
        lines.append("    test.skip(true, 'No stable/actionable locators generated for this page.');")
    for l in stable[:20]:
        m = method_name(l.get("logicalId", "element"), used)
        lines.append(f"    await expect(screen.{m}.first()).toBeAttached();")
    lines += ["  });", "});", ""]
    return "\n".join(lines)

def chunk_object_repository_entries(entries, max_entries=200):
    max_entries = max(1, int(max_entries or 200))
    screen_by_name = {}
    fields_by_screen = {}
    screen_order = []
    ungrouped = []
    for entry in entries or []:
        screen = str(entry.get("screen_name") or entry.get("page_key") or "default").strip() or "default"
        if screen not in fields_by_screen:
            fields_by_screen[screen] = []
            screen_order.append(screen)
        if entry.get("record_type") == "screen":
            screen_by_name.setdefault(screen, entry)
        elif entry.get("record_type") == "field":
            fields_by_screen[screen].append(entry)
        else:
            ungrouped.append(entry)
    batches = []
    for screen in screen_order:
        screen_entry = screen_by_name.get(screen) or synthesize_screen_entry(screen)
        fields = fields_by_screen.get(screen) or []
        if not fields:
            batches.append([screen_entry][:max_entries])
            continue
        field_window = max(1, max_entries - 1)
        for i in range(0, len(fields), field_window):
            batches.append([screen_entry] + fields[i:i + field_window])
    for i in range(0, len(ungrouped), max_entries):
        batches.append(ungrouped[i:i + max_entries])
    return batches or [[]]

def synthesize_screen_entry(screen):
    return {
        "screen_name": screen,
        "record_type": "screen",
        "page_url": screen,
        "page_key": screen,
        "locator_intent": "__screen__",
        "locator": "__screen__",
        "locator_kind": "screen",
        "confidence": 0.8,
        "source": "qaira_repository_agent",
        "object_name": "__screen__",
        "object_role": "screen",
        "metadata": {"url_pattern_type": "contains", "url_pattern_value": screen, "target_criteria": [], "fallback_locators": [], "usage_keywords": [], "stability_score": 0.8, "record_kind": "screen", "screen_name": screen}
    }

def render_or_batch_curl(batch_dir="generated/webui/object_repository_batches"):
    return """#!/usr/bin/env sh
set -eu
QAIRA_IMPORT_URL=${QAIRA_IMPORT_URL:-http://localhost:8080/api/test-cases/automation/learning-cache/import}
BATCH_DIR=${1:-%s}
if [ -n "${QAIRA_BEARER_TOKEN:-}" ]; then
  AUTH_HEADER="authorization: Bearer $QAIRA_BEARER_TOKEN"
elif [ -n "${QAIRA_API_KEY:-}" ]; then
  AUTH_HEADER="x-api-key: $QAIRA_API_KEY"
else
  echo "Set QAIRA_BEARER_TOKEN or QAIRA_API_KEY before running this import curl." >&2
  exit 2
fi
for payload in "$BATCH_DIR"/batch-*.json; do
  [ -f "$payload" ] || continue
  echo "Importing $payload"
  curl "$QAIRA_IMPORT_URL" -H "$AUTH_HEADER" -H "content-type: application/json" --data-raw "@$payload"
  echo
done
""" % batch_dir

def app_type_id_from_config(config):
    for path in [("qaira_import", "app_type_id"), ("webui", "app_type_id"), ("import", "app_type_id")]:
        cur = config or {}
        try:
            for key in path:
                cur = cur.get(key, {}) if isinstance(cur, dict) else {}
            if isinstance(cur, str) and cur.strip():
                return cur.strip()
        except Exception:
            pass
    return os.environ.get("QAIRA_APP_TYPE_ID", "a2")

def render_or_curl(payload_path="generated/webui/object_repository_import_payload.json"):
    return """#!/usr/bin/env sh
set -eu
QAIRA_IMPORT_URL=${QAIRA_IMPORT_URL:-http://localhost:8080/api/test-cases/automation/learning-cache/import}
PAYLOAD_FILE=${1:-%s}
if [ -n "${QAIRA_BEARER_TOKEN:-}" ]; then
  curl "$QAIRA_IMPORT_URL" \\
    -H "authorization: Bearer $QAIRA_BEARER_TOKEN" \\
    -H "content-type: application/json" \\
    --data-raw "@$PAYLOAD_FILE"
elif [ -n "${QAIRA_API_KEY:-}" ]; then
  curl "$QAIRA_IMPORT_URL" \\
    -H "x-api-key: $QAIRA_API_KEY" \\
    -H "content-type: application/json" \\
    --data-raw "@$PAYLOAD_FILE"
else
  echo "Set QAIRA_BEARER_TOKEN or QAIRA_API_KEY before running this import curl." >&2
  exit 2
fi
""" % payload_path

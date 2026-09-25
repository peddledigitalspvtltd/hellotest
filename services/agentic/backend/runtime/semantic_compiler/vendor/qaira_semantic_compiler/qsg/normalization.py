from __future__ import annotations
from typing import Any, Dict, List
import re, json

_STRING_KEYS = {"tagName", "tag", "role", "text", "label", "ariaLabel", "name", "placeholder", "type", "testId", "id", "title", "value", "component", "route"}
_BOOL_KEYS = {"onClick", "required", "disabled", "checked", "multiple"}

BAD_ACCESSIBLE_NAME_RE = re.compile(r"(=>|\bset[A-Z]|\bhandle[A-Z]|\bon[A-Z]|event\.|currentTarget|target\.value|target\.checked|\$\{|`|\)\s*=>|\bvoid\s+|\bMath\.|\bNumber\(|\[\]|\.mutate\(|\.current|stopPropagation|preventDefault)")
MEANINGLESS_ACCESSIBLE_NAME_RE = re.compile(r"^[\s\W_0-9]{1,4}$")

def is_bad_accessible_name(text: str) -> bool:
    s = safe_str(text)
    return (not s) or bool(BAD_ACCESSIBLE_NAME_RE.search(s)) or bool(MEANINGLESS_ACCESSIBLE_NAME_RE.match(s))

def locator_has_bad_expression(locator: str) -> bool:
    s = safe_str(locator)
    return bool(BAD_ACCESSIBLE_NAME_RE.search(s)) or bool(re.search(r"getByText\('(?:\d+|::|\)\)|,|;)" , s))


def flatten_values(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        out: List[Any] = []
        for item in value:
            out.extend(flatten_values(item))
        return out
    if isinstance(value, tuple) or isinstance(value, set):
        out: List[Any] = []
        for item in value:
            out.extend(flatten_values(item))
        return out
    return [value]

def safe_str(value: Any, default: str = "") -> str:
    values = flatten_values(value)
    for item in values:
        if item is None:
            continue
        if isinstance(item, bool):
            return "true" if item else "false"
        if isinstance(item, (int, float)):
            return str(item)
        if isinstance(item, dict):
            # Prefer common symbolic values before JSON fallback.
            for k in ["name", "value", "text", "label", "id"]:
                if item.get(k) not in [None, ""]:
                    return safe_str(item.get(k), default)
            return json.dumps(item, sort_keys=True, default=str)
        s = str(item).strip()
        if s:
            return re.sub(r"\s+", " ", s)
    return default

def safe_list(value: Any) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in flatten_values(value):
        s = safe_str(item)
        if s and s not in seen:
            out.append(s); seen.add(s)
    return out

def safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    s = safe_str(value).lower()
    return s in {"1", "true", "yes", "y", "on", "click", "onclick"}

def normalize_facts(facts: Dict[str, Any] | None) -> Dict[str, Any]:
    facts = facts or {}
    out: Dict[str, Any] = {}
    for key, value in facts.items():
        if key in _BOOL_KEYS:
            out[key] = safe_bool(value)
        elif key in _STRING_KEYS:
            out[key] = safe_str(value)
            vals = safe_list(value)
            if len(vals) > 1:
                out[f"{key}Values"] = vals
        else:
            # Keep rich facts, but flatten one-element arrays to avoid analyzer crashes.
            vals = flatten_values(value)
            if len(vals) == 0:
                out[key] = ""
            elif len(vals) == 1:
                out[key] = vals[0]
            else:
                out[key] = vals
    # Canonical aliases used by analyzers.
    if not out.get("tagName") and out.get("tag"):
        out["tagName"] = out["tag"]
    if out.get("tagName"):
        out["tagName"] = out["tagName"].lower()
    if out.get("role"):
        out["role"] = out["role"].lower()
    return out

def normalize_locator_record(locator: Dict[str, Any] | None) -> Dict[str, Any]:
    locator = dict(locator or {})
    evidence = normalize_facts(locator.get("evidence") or {})
    locator["evidence"] = evidence
    for key in ["tagName", "role", "text", "label", "name"]:
        if key in locator:
            locator[key] = safe_str(locator.get(key))
        elif evidence.get(key):
            locator[key] = evidence.get(key)
    locator["page"] = safe_str(locator.get("page") or evidence.get("route") or route_from_logical(locator.get("logicalId", "")), "/") or "/"
    locator["locatorRisk"] = safe_str(locator.get("locatorRisk") or "high")
    locator["candidates"] = [c for c in (locator.get("candidates") or []) if isinstance(c, dict) and safe_str(c.get("locator"))]
    return locator

def route_from_logical(logical: str) -> str:
    logical = safe_str(logical)
    if logical.startswith("ui://"):
        parts = logical[len("ui://"):].split("/")
        return "/" + (parts[0] if parts and parts[0] else "")
    return "/"

def is_stable_candidate(candidate: Dict[str, Any] | None) -> bool:
    if not candidate:
        return False
    strategy = safe_str(candidate.get("strategy"))
    confidence = candidate.get("confidence", 0)
    try:
        confidence = float(confidence)
    except Exception:
        confidence = 0
    locator = safe_str(candidate.get("locator"))
    if not locator or "TODO stable locator" in locator or locator_has_bad_expression(locator):
        return False
    return strategy in {"getByTestId", "getByRole", "getByLabel", "getByText"} and confidence >= 0.70

def is_actionable_locator(locator: Dict[str, Any]) -> bool:
    locator = normalize_locator_record(locator)
    if locator.get("locatorRisk") == "high":
        return False
    return bool(locator.get("candidates") and is_stable_candidate(locator.get("candidates", [None])[0]))


def is_interactive_facts(facts: Dict[str, Any] | None) -> bool:
    f = normalize_facts(facts or {})
    tag = safe_str(f.get("tagName")).lower()
    role = safe_str(f.get("role")).lower()
    typ = safe_str(f.get("type")).lower()
    interactive_tags = {"button", "a", "input", "select", "textarea", "summary", "option"}
    interactive_roles = {"button", "link", "textbox", "checkbox", "radio", "combobox", "switch", "tab", "menuitem", "option", "slider", "spinbutton", "searchbox"}
    if tag in interactive_tags or role in interactive_roles:
        return True
    if typ in {"button", "submit", "reset", "checkbox", "radio", "search", "email", "password", "number", "tel", "url", "date", "file"}:
        return True
    return bool(f.get("onClick") or f.get("href") or f.get("onSubmit") or f.get("onChange"))

def locator_priority(locator: Dict[str, Any] | None) -> int:
    l = normalize_locator_record(locator or {})
    evidence = l.get("evidence") or {}
    if is_interactive_facts({**evidence, **l}):
        return 100
    tag = safe_str(l.get("tagName") or evidence.get("tagName")).lower()
    if tag in {"form", "dialog", "section", "main", "nav"}:
        return 60
    return 20

def page_component_key(item: Dict[str, Any] | None) -> str:
    item = item or {}
    ev = item.get("evidence") or {}
    page = safe_str(item.get("page") or ev.get("route") or route_from_logical(item.get("logicalId", "")), "/") or "/"
    component = safe_str(item.get("component") or ev.get("component") or "unknown") or "unknown"
    return f"{page}::{component}"

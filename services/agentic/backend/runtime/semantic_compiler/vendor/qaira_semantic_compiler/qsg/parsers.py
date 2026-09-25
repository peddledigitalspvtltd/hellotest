from __future__ import annotations
from pathlib import Path
from typing import Dict, Iterable, List, Any, Optional, Tuple
import re, json
from qaira_semantic_compiler.core.ignore import QAIgnore
from .kernel import GraphEmitter, stable_id, safe_slug

UI_EXTS = {".tsx", ".jsx", ".html", ".vue", ".svelte"}
JS_EXTS = {".ts", ".tsx", ".js", ".jsx"}
API_EXTS = {".ts", ".js", ".tsx", ".jsx", ".json", ".yaml", ".yml"}
SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "coverage", "qaira-output", "qaira-learning", "__pycache__"}

TAG_RE = re.compile(r"<([A-Za-z][A-Za-z0-9._:-]*)(\s[^<>]*?)?>", re.S)
ATTR_RE = re.compile(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|\{([^}]*)\})")
TEXT_RE = re.compile(r">\s*([^<>{}\n][^<>{}\n]{0,80})\s*<")
ROUTE_HANDLER_RE = re.compile(r"(?:app|router|server)\.(get|post|put|patch|delete|head|options)\s*\(\s*['\"]([^'\"]+)", re.I)
FETCH_RE = re.compile(r"(?:fetch|axios\.(get|post|put|patch|delete))\s*\(\s*['\"]([^'\"]+)", re.I)
NEXT_ROUTE_EXPORT_RE = re.compile(r"export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b")
ZOD_OBJECT_RE = re.compile(r"(?:const|export\s+const)\s+(\w+)\s*=\s*z\.object\s*\(\s*\{(?P<body>.*?)\}\s*\)", re.S)
ZOD_FIELD_RE = re.compile(r"(\w+)\s*:\s*z\.([A-Za-z0-9_]+)\s*\((.*?)\)(?P<chain>(?:\.[A-Za-z0-9_]+\([^)]*\))*)", re.S)
REGISTER_RE = re.compile(r"register\s*\(\s*['\"]([^'\"]+)['\"]")
CONTROLLER_RE = re.compile(r"(?:class|function|const)\s+(\w*(?:Controller|Handler|Service)\w*)")

HTML_TAG_TO_ROLE = {
    "button": "button", "a": "link", "input": "textbox", "select": "combobox", "textarea": "textbox",
    "form": "form", "nav": "navigation", "main": "main", "header": "banner", "footer": "contentinfo",
    "h1": "heading", "h2": "heading", "h3": "heading", "h4": "heading", "h5": "heading", "h6": "heading"
}
FORM_TAGS = {"input", "select", "textarea"}
CLICKABLE_TAGS = {"button", "a"}

class ParserContext:
    def __init__(self, source: Path):
        self.source = Path(source)

    def rel(self, path: Path) -> str:
        try: return str(path.relative_to(self.source))
        except Exception: return str(path)

class SourceFile:
    def __init__(self, path: Path, root: Path):
        self.path = path
        self.root = root
        self.rel = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
        self.ext = path.suffix.lower()
        try: self.text = path.read_text(encoding="utf-8", errors="ignore")
        except Exception: self.text = ""

class QsgParserPlugin:
    name = "base"
    ontology_version = "1.0.0"
    def supports(self, file: SourceFile) -> bool: return False
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None: pass

class ReactParser(QsgParserPlugin):
    name = "qaira-parser-react"
    def supports(self, file: SourceFile) -> bool:
        return file.ext in UI_EXTS and ("<" in file.text and ">" in file.text)

    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        route = route_from_file(file.rel)
        route_id = f"route://{safe_slug(route)}"
        emit.node({"logical_id": route_id, "type": "ROUTE_ENTRY", "physical_id": phys(file.rel, "route"), "metadata": {"path": route, "file": file.rel}})
        container_id = f"ui://{safe_slug(route)}/container/{safe_slug(Path(file.rel).stem)}"
        emit.node({"logical_id": container_id, "type": "UI_CONTAINER", "physical_id": phys(file.rel, "container"), "metadata": {"file": file.rel, "component": component_name(file)}})
        emit.edge({"source_logical_id": route_id, "target_logical_id": container_id, "type": "CONTAINS"})

        labels_by_for = {}
        for m in TAG_RE.finditer(file.text):
            tag = m.group(1)
            attrs = parse_attrs(m.group(2) or "")
            if tag.lower() == "label" and ("htmlFor" in attrs or "for" in attrs):
                label_text = nearby_text(file.text, m.end()) or attrs.get("aria-label") or attrs.get("title") or ""
                labels_by_for[attrs.get("htmlFor") or attrs.get("for")] = label_text.strip()

        idx = 0
        for m in TAG_RE.finditer(file.text):
            tag = m.group(1)
            tag_l = tag.lower()
            attrs = parse_attrs(m.group(2) or "")
            if tag_l not in {"button","input","select","textarea","a","div","span","label","form"} and not attrs.get("data-testid") and not attrs.get("role"):
                continue
            idx += 1
            line = file.text[:m.start()].count("\n") + 1
            text = nearby_text(file.text, m.end())
            element_name = attrs.get("data-testid") or attrs.get("id") or attrs.get("name") or attrs.get("aria-label") or text or f"{tag_l}-{idx}"
            logical = f"ui://{safe_slug(route)}/{safe_slug(element_name)}"
            role = attrs.get("role") or HTML_TAG_TO_ROLE.get(tag_l)
            if tag_l == "input":
                typ = (attrs.get("type") or "text").strip("'\"")
                if typ in ["checkbox"]: role = "checkbox"
                elif typ in ["radio"]: role = "radio"
                elif typ in ["submit", "button"]: role = "button"
            metadata = {"file": file.rel, "line": line, "tagName": tag_l, "attrs": attrs, "route": route, "component": component_name(file)}
            emit.node({"logical_id": logical, "type": "UI_ELEMENT", "physical_id": phys(file.rel, f"{tag_l}:{line}:{idx}"), "metadata": metadata})
            emit.edge({"source_logical_id": container_id, "target_logical_id": logical, "type": "CONTAINS"})
            facts = {"tagName": tag_l, "role": role, "text": text, "testId": attrs.get("data-testid") or attrs.get("data-test-id"), "id": attrs.get("id"), "name": attrs.get("name"), "ariaLabel": attrs.get("aria-label"), "type": attrs.get("type"), "href": attrs.get("href"), "onClick": attrs.get("onClick"), "placeholder": attrs.get("placeholder"), "label": labels_by_for.get(attrs.get("id"))}
            for k, v in facts.items():
                if v not in [None, ""]:
                    emit.fact({"owner_logical_id": logical, "property": k, "value": v, "evidence": {"file": file.rel, "line": line}})
            field = attrs.get("name") or attrs.get("id") or attrs.get("aria-label") or attrs.get("placeholder")
            if tag_l in FORM_TAGS or attrs.get("name"):
                field_name = safe_field(field or element_name)
                entity_id = f"entity://{safe_slug(route)}/Form"
                field_id = f"field://{safe_slug(route)}/{safe_slug(field_name)}"
                alias_id = f"alias://{safe_slug(route)}/{safe_slug(element_name)}"
                emit.node({"logical_id": entity_id, "type": "BUSINESS_ENTITY", "physical_id": phys(file.rel, "entity", route), "metadata": {"name": "Form", "route": route}})
                emit.node({"logical_id": field_id, "type": "BUSINESS_FIELD", "physical_id": phys(file.rel, "field", field_name), "metadata": {"name": field_name}})
                emit.node({"logical_id": alias_id, "type": "FIELD_ALIAS", "physical_id": phys(file.rel, "alias", element_name), "metadata": {"alias": element_name}})
                emit.edge({"source_logical_id": entity_id, "target_logical_id": field_id, "type": "HAS_FIELD"})
                emit.edge({"source_logical_id": logical, "target_logical_id": field_id, "type": "BINDS_FIELD", "confidence_score": 0.85})
                emit.edge({"source_logical_id": logical, "target_logical_id": alias_id, "type": "USES_FIELD_ALIAS"})
                emit.edge({"source_logical_id": alias_id, "target_logical_id": field_id, "type": "RESOLVES_TO", "confidence_score": 0.75})
            if attrs.get("onClick") or tag_l in CLICKABLE_TAGS:
                mut_id = f"mutation://{safe_slug(route)}/{safe_slug(element_name)}"
                emit.node({"logical_id": mut_id, "type": "STATE_MUTATION", "physical_id": phys(file.rel, "mutation", line), "metadata": {"handler": attrs.get("onClick"), "file": file.rel, "line": line}})
                emit.edge({"source_logical_id": logical, "target_logical_id": mut_id, "type": "TRIGGERS", "confidence_score": 0.7})

class NextJsParser(QsgParserPlugin):
    name = "qaira-parser-nextjs"
    def supports(self, file: SourceFile) -> bool:
        return file.ext in JS_EXTS and ("/app/" in "/" + file.rel or "/pages/" in "/" + file.rel or file.rel.startswith("app/") or file.rel.startswith("pages/"))
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        route = route_from_file(file.rel)
        rid = f"route://{safe_slug(route)}"
        emit.node({"logical_id": rid, "type": "ROUTE_ENTRY", "physical_id": phys(file.rel, "next-route"), "metadata": {"path": route, "file": file.rel, "framework": "nextjs"}})
        for m in NEXT_ROUTE_EXPORT_RE.finditer(file.text):
            method = m.group(1).upper()
            api_id = f"api://{method}/{safe_slug(route)}"
            emit.node({"logical_id": api_id, "type": "API_ENDPOINT", "physical_id": phys(file.rel, "next-api", method), "metadata": {"method": method, "path": route, "file": file.rel}})
            emit.edge({"source_logical_id": rid, "target_logical_id": api_id, "type": "ROUTES_TO"})

class ZodParser(QsgParserPlugin):
    name = "qaira-parser-zod"
    def supports(self, file: SourceFile) -> bool: return file.ext in JS_EXTS and "z.object" in file.text
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        for obj in ZOD_OBJECT_RE.finditer(file.text):
            schema_name = obj.group(1)
            ent_id = f"entity://schema/{safe_slug(schema_name)}"
            emit.node({"logical_id": ent_id, "type": "BUSINESS_ENTITY", "physical_id": phys(file.rel, "zod", schema_name), "metadata": {"schema": schema_name, "file": file.rel}})
            body = obj.group("body")
            for fm in ZOD_FIELD_RE.finditer(body):
                fname, ztype, args, chain = fm.group(1), fm.group(2), fm.group(3), fm.group("chain") or ""
                field_id = f"field://schema/{safe_slug(schema_name)}/{safe_slug(fname)}"
                emit.node({"logical_id": field_id, "type": "BUSINESS_FIELD", "physical_id": phys(file.rel, "zod-field", schema_name, fname), "metadata": {"name": fname, "zodType": ztype, "schema": schema_name}})
                emit.edge({"source_logical_id": ent_id, "target_logical_id": field_id, "type": "HAS_FIELD"})
                emit.fact({"owner_logical_id": field_id, "property": "dataType", "value": ztype, "evidence": {"file": file.rel}})
                rules = extract_zod_rules(ztype, args, chain)
                for r in rules:
                    rule_id = f"rule://schema/{safe_slug(schema_name)}/{safe_slug(fname)}/{safe_slug(r['kind'] + '-' + str(r.get('value','')))}"
                    emit.node({"logical_id": rule_id, "type": "VALIDATION_RULE", "physical_id": phys(file.rel, "rule", schema_name, fname, r), "metadata": r})
                    emit.edge({"source_logical_id": field_id, "target_logical_id": rule_id, "type": "HAS_RULE"})

class ReactHookFormParser(QsgParserPlugin):
    name = "qaira-parser-react-hook-form"
    def supports(self, file: SourceFile) -> bool: return file.ext in JS_EXTS and "register(" in file.text
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        route = route_from_file(file.rel)
        for m in REGISTER_RE.finditer(file.text):
            field = m.group(1)
            field_id = f"field://{safe_slug(route)}/{safe_slug(field)}"
            emit.node({"logical_id": field_id, "type": "BUSINESS_FIELD", "physical_id": phys(file.rel, "rhf", field), "metadata": {"name": field, "source": "react-hook-form", "file": file.rel}})
            emit.fact({"owner_logical_id": field_id, "property": "registeredBy", "value": "react-hook-form", "evidence": {"file": file.rel, "line": file.text[:m.start()].count('\n')+1}})

class TanStackQueryParser(QsgParserPlugin):
    name = "qaira-parser-tanstack-query"
    def supports(self, file: SourceFile) -> bool: return file.ext in JS_EXTS and ("useQuery" in file.text or "useMutation" in file.text)
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        route = route_from_file(file.rel)
        for keyword in ["useQuery", "useMutation"]:
            for m in re.finditer(keyword + r"\s*\(", file.text):
                line = file.text[:m.start()].count("\n") + 1
                res_id = f"resource://{safe_slug(route)}/{keyword}-{line}"
                emit.node({"logical_id": res_id, "type": "DATA_RESOURCE", "physical_id": phys(file.rel, keyword, line), "metadata": {"hook": keyword, "file": file.rel, "line": line}})

class ExpressFastifyParser(QsgParserPlugin):
    name = "qaira-parser-express-fastify"
    def supports(self, file: SourceFile) -> bool: return file.ext in JS_EXTS and (".get(" in file.text or ".post(" in file.text or "fastify" in file.text)
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        for m in ROUTE_HANDLER_RE.finditer(file.text):
            method, path = m.group(1).upper(), m.group(2)
            api_id = f"api://{method}/{safe_slug(path)}"
            emit.node({"logical_id": api_id, "type": "API_ENDPOINT", "physical_id": phys(file.rel, "api", method, path), "metadata": {"method": method, "path": path, "file": file.rel, "line": file.text[:m.start()].count('\n')+1}})
        for m in CONTROLLER_RE.finditer(file.text):
            name = m.group(1)
            typ = "SERVICE_FUNCTION" if "Service" in name else "BACKEND_CONTROLLER"
            emit.node({"logical_id": f"backend://{safe_slug(name)}", "type": typ, "physical_id": phys(file.rel, "backend", name), "metadata": {"name": name, "file": file.rel}})

class OpenApiParser(QsgParserPlugin):
    name = "qaira-parser-openapi"
    def supports(self, file: SourceFile) -> bool:
        return file.ext in {".json", ".yaml", ".yml"} and ("openapi" in file.text[:2000].lower() or '"paths"' in file.text[:2000])
    def parse(self, ctx: ParserContext, file: SourceFile, emit: GraphEmitter) -> None:
        # Lightweight parser to avoid optional yaml dependency assumptions in plugin SDK; yaml is available in runtime but keep fail-open.
        for m in re.finditer(r"\n\s{0,4}(/[A-Za-z0-9_./{}:-]+)\s*:", file.text):
            path = m.group(1)
            window = file.text[m.end():m.end()+600]
            for method in re.findall(r"\n\s{2,8}(get|post|put|patch|delete|head|options)\s*:", window, re.I):
                api_id = f"api://{method.upper()}/{safe_slug(path)}"
                emit.node({"logical_id": api_id, "type": "API_ENDPOINT", "physical_id": phys(file.rel, "openapi", method, path), "metadata": {"method": method.upper(), "path": path, "file": file.rel}})

def iter_source_files(root: Path, config: Dict[str, Any] | None = None) -> Iterable[SourceFile]:
    """Yield application source files only.

    Uses the same QAIgnore guardrails as the API repository index so WebUI/QSG
    extraction does not scan node_modules, build output, tests, fixtures, or QAira
    generated artifacts. This keeps locator and graph counts application-accurate.
    """
    root = Path(root)
    ignore = QAIgnore.load(root, config or {})
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            children = list(current.iterdir())
        except Exception:
            continue
        for p in children:
            if ignore.is_ignored(p):
                continue
            if p.is_dir():
                stack.append(p)
                continue
            if not p.is_file():
                continue
            if p.suffix.lower() not in (UI_EXTS | API_EXTS):
                continue
            try:
                if p.stat().st_size > 512_000:
                    continue
            except Exception:
                continue
            yield SourceFile(p, root)

def default_plugins(enabled: Dict[str, Any] | None = None) -> List[QsgParserPlugin]:
    enabled = enabled or {}
    candidates = [NextJsParser(), ReactParser(), ZodParser(), ReactHookFormParser(), TanStackQueryParser(), ExpressFastifyParser(), OpenApiParser()]
    out = []
    for p in candidates:
        key = p.name.replace("qaira-parser-", "").replace("-", "_")
        if enabled.get(key, True): out.append(p)
    return out

def parse_attrs(raw: str) -> Dict[str, str]:
    out = {}
    for m in ATTR_RE.finditer(raw or ""):
        out[m.group(1)] = next((g for g in m.groups()[1:] if g is not None), "")
    return out

def nearby_text(text: str, pos: int) -> str:
    s = text[pos:pos+180]
    m = re.match(r"\s*([^<>{}\n][^<>{}\n]{0,80})", s)
    if m: return re.sub(r"\s+", " ", m.group(1)).strip()
    return ""

def route_from_file(rel: str) -> str:
    rel = rel.replace("\\", "/")
    parts = rel.split("/")
    if "app" in parts:
        idx = parts.index("app")
        route_parts = [p for p in parts[idx+1:-1] if not p.startswith("(")]
        return "/" + "/".join(route_parts).replace("[", ":").replace("]", "") if route_parts else "/"
    if "pages" in parts:
        idx = parts.index("pages")
        route = "/" + "/".join(parts[idx+1:]).rsplit(".",1)[0]
        route = route.replace("/index", "").replace("[", ":").replace("]", "")
        return route or "/"
    return "/" + Path(rel).stem

def component_name(file: SourceFile) -> str:
    m = re.search(r"(?:export\s+default\s+function|function|const)\s+([A-Z][A-Za-z0-9_]*)", file.text)
    return m.group(1) if m else Path(file.rel).stem

def phys(*parts: Any) -> str:
    return "sha256:" + stable_id(*parts)

def safe_field(name: str) -> str:
    name = (name or "field").strip()
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)
    return name or "field"

def extract_zod_rules(ztype: str, args: str, chain: str) -> List[Dict[str, Any]]:
    rules = [{"kind": "type", "value": ztype}]
    for name, value in re.findall(r"\.(min|max|length|email|url|uuid|regex|optional|required)\s*\(([^)]*)\)", chain or ""):
        clean = value.strip().strip('"\'')
        rules.append({"kind": name, "value": clean})
    if ".optional(" in chain:
        rules.append({"kind": "optional", "value": True})
    else:
        rules.append({"kind": "required", "value": True})
    return rules

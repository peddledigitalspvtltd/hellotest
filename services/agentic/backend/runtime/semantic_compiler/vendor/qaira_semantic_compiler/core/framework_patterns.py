from __future__ import annotations
from pathlib import Path
import json, re, xml.etree.ElementTree as ET
from typing import Any, Dict, List

FRONTEND_FRAMEWORKS = {
    "react": {"signals": ["react", "react-dom"], "routes": ["react-router-dom", "@tanstack/react-router", "next", "remix"], "component_exts": [".tsx", ".jsx"]},
    "nextjs": {"signals": ["next"], "route_dirs": ["app", "pages"], "api_dirs": ["app/api", "pages/api"]},
    "remix": {"signals": ["@remix-run/react", "@remix-run/node"], "route_dirs": ["app/routes"]},
    "vue": {"signals": ["vue"], "routes": ["vue-router", "nuxt"], "component_exts": [".vue"]},
    "nuxt": {"signals": ["nuxt", "nuxt3"], "route_dirs": ["pages", "server/api"]},
    "angular": {"signals": ["@angular/core"], "route_files": ["app-routing.module.ts", "*.routes.ts"], "component_exts": [".component.ts", ".component.html"]},
    "svelte": {"signals": ["svelte", "@sveltejs/kit"], "route_dirs": ["src/routes"], "component_exts": [".svelte"]},
    "astro": {"signals": ["astro"], "route_dirs": ["src/pages"], "component_exts": [".astro", ".tsx", ".jsx", ".vue", ".svelte"]},
    "solid": {"signals": ["solid-js", "@solidjs/router"], "component_exts": [".tsx", ".jsx"]},
}

BACKEND_FRAMEWORKS = {
    "express": ["express"], "fastify": ["fastify"], "nestjs": ["@nestjs/core", "@nestjs/common"],
    "hono": ["hono"], "koa": ["koa"], "spring": ["spring-boot", "spring-web", "spring-boot-starter-web"],
    "fastapi": ["fastapi"], "flask": ["flask"], "django": ["django"],
    "rails": ["rails"], "laravel": ["laravel/framework"], "aspnet": ["Microsoft.AspNetCore"],
    "go-gin": ["github.com/gin-gonic/gin"], "go-echo": ["github.com/labstack/echo"], "go-fiber": ["github.com/gofiber/fiber"],
}

DESIGN_SYSTEM_HINTS = [
    "Button", "IconButton", "TextField", "Input", "Select", "Combobox", "Dialog", "Modal", "Tabs", "Menu", "Dropdown", "DataTable", "Table", "Grid", "Form", "Card", "Toast", "Alert"
]

API_CLIENT_HINTS = ["fetch", "axios", "graphql-request", "@apollo/client", "urql", "@tanstack/react-query", "react-query", "@reduxjs/toolkit", "swr", "ky"]

ROUTE_WRAPPER_HINTS = ["defineRoute", "createRoute", "createFileRoute", "createBrowserRouter", "RouterModule.forRoot", "Route", "QairaRoute", "AppScreen", "definePage"]


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return {}


def read_text(path: Path, max_chars: int = 200000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
    except Exception:
        return ""


def package_deps(source: Path) -> dict:
    deps={}
    for pkg in source.rglob("package.json"):
        if any(part in {"node_modules", "dist", "build", ".next", "qaira-output"} for part in pkg.parts):
            continue
        data=read_json(pkg)
        for section in ["dependencies","devDependencies","peerDependencies","optionalDependencies"]:
            for k,v in (data.get(section) or {}).items(): deps[k]=v
    return deps


def scan_manifest_files(source: Path) -> dict:
    signals={"java": [], "python": [], "go": [], "dotnet": [], "php": [], "ruby": []}
    for p in list(source.glob("pom.xml")) + list(source.rglob("pom.xml"))[:20]:
        txt=read_text(p,50000).lower()
        if "spring-boot" in txt or "springframework" in txt: signals["java"].append(str(p.relative_to(source)))
    for p in list(source.glob("build.gradle")) + list(source.rglob("build.gradle"))[:20]:
        txt=read_text(p,50000).lower()
        if "spring" in txt: signals["java"].append(str(p.relative_to(source)))
    for name in ["requirements.txt", "pyproject.toml", "Pipfile"]:
        for p in source.rglob(name):
            txt=read_text(p,50000).lower()
            if "fastapi" in txt or "flask" in txt or "django" in txt: signals["python"].append(str(p.relative_to(source)))
    for p in source.rglob("go.mod"):
        txt=read_text(p,50000)
        if any(x in txt for x in BACKEND_FRAMEWORKS["go-gin"]+BACKEND_FRAMEWORKS["go-echo"]+BACKEND_FRAMEWORKS["go-fiber"]): signals["go"].append(str(p.relative_to(source)))
    for p in source.rglob("*.csproj"):
        txt=read_text(p,50000)
        if "Microsoft.AspNetCore" in txt: signals["dotnet"].append(str(p.relative_to(source)))
    for p in source.rglob("composer.json"):
        txt=read_text(p,50000)
        if "laravel/framework" in txt: signals["php"].append(str(p.relative_to(source)))
    for p in source.rglob("Gemfile"):
        txt=read_text(p,50000).lower()
        if "rails" in txt: signals["ruby"].append(str(p.relative_to(source)))
    return {k:v for k,v in signals.items() if v}


def source_signals(source: Path) -> dict:
    counts={"tsx":0,"jsx":0,"vue":0,"svelte":0,"angular_templates":0,"api_like":0,"di_like":0,"custom_wrappers":0,"graphql":0,"openapi":0,"serverless":0}
    examples={k:[] for k in counts}
    for p in source.rglob("*"):
        if not p.is_file(): continue
        rp=str(p.relative_to(source)).replace("\\","/")
        if any(part in rp for part in ["node_modules/","dist/","build/",".git/",".next/","qaira-output/","coverage/"]): continue
        suffix=p.suffix.lower(); txt=""
        if suffix in {".tsx",".jsx",".ts",".js",".vue",".svelte",".html",".java",".py",".go",".cs",".php",".rb",".yaml",".yml",".json"}:
            txt=read_text(p,30000)
        if suffix==".tsx": bump(counts, examples, "tsx", rp)
        if suffix==".jsx": bump(counts, examples, "jsx", rp)
        if suffix==".vue": bump(counts, examples, "vue", rp)
        if suffix==".svelte": bump(counts, examples, "svelte", rp)
        if p.name.endswith(".component.html") or p.name.endswith(".component.ts"): bump(counts, examples, "angular_templates", rp)
        if re.search(r"router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)|@GetMapping|@PostMapping|@Controller\b|@RestController\b|APIRouter\(|@app\.route|Map(Get|Post|Put|Delete)|Route::(get|post)", txt): bump(counts, examples, "api_like", rp)
        if re.search(r"@Injectable|@Autowired|Depends\(|dependency_overrides|ServiceCollection|container\.resolve|Inversify|tsyringe|Guice|Dagger", txt): bump(counts, examples, "di_like", rp)
        if any(h in txt for h in ROUTE_WRAPPER_HINTS): bump(counts, examples, "custom_wrappers", rp)
        if re.search(r"GraphQL|gql`|type Query|type Mutation|graphql\(", txt): bump(counts, examples, "graphql", rp)
        if "openapi" in rp.lower() or "swagger" in rp.lower() or "openapi" in txt.lower(): bump(counts, examples, "openapi", rp)
        if p.name in {"serverless.yml","serverless.yaml","template.yaml","template.yml"} or "aws_apigateway" in txt or "aws_api_gateway" in txt: bump(counts, examples, "serverless", rp)
    return {"counts":counts,"examples":examples}


def bump(counts, examples, key, rp):
    counts[key]=counts.get(key,0)+1
    if len(examples.setdefault(key,[]))<10: examples[key].append(rp)


def detect_repository_patterns(source: Path, config: dict|None=None) -> dict:
    config=config or {}
    deps=package_deps(source)
    manifests=scan_manifest_files(source)
    sig=source_signals(source)
    front=[]; back=[]; api_clients=[]
    for fw,meta in FRONTEND_FRAMEWORKS.items():
        if any(d in deps for d in meta.get("signals",[])):
            front.append({"framework":fw,"confidence":0.95,"evidence":[d for d in meta.get("signals",[]) if d in deps]})
    for fw,signals in BACKEND_FRAMEWORKS.items():
        evid=[s for s in signals if s in deps or any(s in str(v) for v in manifests.values())]
        if evid:
            back.append({"framework":fw,"confidence":0.9,"evidence":evid})
    if manifests.get("java") and not any(b["framework"]=="spring" for b in back): back.append({"framework":"spring","confidence":0.75,"evidence":manifests.get("java")[:5]})
    if manifests.get("python"):
        for fw in ["fastapi","flask","django"]:
            if any(fw in read_text(source/p,50000).lower() for p in manifests.get("python",[]) if (source/p).exists()): back.append({"framework":fw,"confidence":0.75,"evidence":manifests.get("python")[:5]})
    for hint in API_CLIENT_HINTS:
        if hint in deps or sig["counts"].get("api_like",0)>0:
            api_clients.append(hint)
    custom=(config.get("qaira") or {}).get("custom_patterns") or config.get("custom_patterns") or {}
    gaps=[]
    if sig["counts"].get("custom_wrappers",0): gaps.append("custom_route_or_page_wrappers_detected_add_custom_patterns")
    if sig["counts"].get("di_like",0): gaps.append("dependency_injection_or_reflection_detected_static_confidence_partial")
    if sig["counts"].get("graphql",0): gaps.append("graphql_schema_or_resolvers_detected_enable_graphql_parser")
    if sig["counts"].get("serverless",0): gaps.append("serverless_or_gateway_routes_detected_include_infra_config")
    if manifests and not back: gaps.append("backend_manifests_found_but_route_framework_unclear")
    return {
        "frontendFrameworks": front,
        "backendFrameworks": back,
        "apiClients": sorted(set(api_clients)),
        "sourceSignals": sig,
        "manifests": manifests,
        "customPatternsConfigured": bool(custom),
        "customPatterns": custom,
        "supportGaps": gaps,
        "recommendedNextConfig": recommended_config(sig, front, back, custom),
        "adapterVersion": "2026.07.08-pro-agentic"
    }


def recommended_config(sig: dict, front: list, back: list, custom: dict) -> dict:
    rec={"custom_patterns": {}}
    if sig["counts"].get("custom_wrappers",0) and not custom:
        rec["custom_patterns"]={
            "api_route_wrappers":[{"function":"QairaRoute.define","path_arg":0,"handler_arg":1,"enabled":False}],
            "page_wrappers":[{"component":"AppScreen","path_prop":"path","component_prop":"component","enabled":False}],
            "design_system":{"button_components":["QButton","IconButton"],"input_components":["QTextField","FormInput"]}
        }
    return rec

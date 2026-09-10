from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.parser import extract_route_calls, extract_next_route_exports
import re

class RouteDiscoveryAgent:
    name="RouteDiscoveryAgent"

    def __init__(self, ctx, logger):
        self.ctx=ctx
        self.logger=logger

    def run(self):
        idx=self.ctx.state["index"]
        raw_routes=[]
        seen_source=set()

        candidate_files = []
        candidate_files += idx.by_kind.get("routes", [])
        candidate_files += idx.by_kind.get("controllers", [])

        # Fallback scan of indexed JS/TS files only. RepositoryIndex already applied .qaignore.
        for p in idx.files:
            rel=str(p.relative_to(idx.source)).replace("\\","/")
            if rel.endswith((".js",".jsx",".ts",".tsx",".mjs",".cjs")) and rel not in candidate_files:
                candidate_files.append(rel)
        # De-duplicate while preserving priority order.
        candidate_files = list(dict.fromkeys(candidate_files))

        for rel in candidate_files:
            if not rel.endswith((".js",".jsx",".ts",".tsx",".mjs",".cjs")):
                continue
            try:
                txt=idx.read(rel)
            except Exception:
                continue
            discovered = list(extract_route_calls(txt)) + list(extract_next_route_exports(txt, rel))
            for c in discovered:
                method = str(c.get("method") or "GET").upper()
                path = normalize_path(c.get("path") or "/")
                key=(rel,c.get("line"),method,path)
                if key in seen_source:
                    continue
                seen_source.add(key)
                raw_routes.append({
                    "method":method,
                    "path":path,
                    "file":rel,
                    "line":c.get("line"),
                    "handler":c.get("handler",""),
                    "call":c.get("call",""),
                    "parser":"balanced_or_nextjs",
                    "sourceScore": source_score(rel),
                })

        routes, duplicate_groups = canonicalize_routes(raw_routes)
        self.ctx.state["routes"]=routes
        self.ctx.write_json("discovery/routes.raw.json", {"count":len(raw_routes),"items":raw_routes})
        self.ctx.write_json("discovery/routes.json", {
            "rawCandidateCount":len(raw_routes),
            "applicationRouteCount":len(routes),
            "duplicateMethodPathGroups":len(duplicate_groups),
            "duplicatesCollapsed":sum(max(0, len(g.get("alternates", []))) for g in duplicate_groups),
            "ignoredByQAIgnore": (idx.summary().get("ignore") or {}).get("ignoredCount", 0),
            "items":routes,
            "duplicateGroups": duplicate_groups[:500]
        })

        status="success" if routes else "failed_open"
        confidence=0.98 if routes else 0.0
        return AgentResult(self.name,status,confidence,{"rawRoutes":len(raw_routes),"routes":len(routes),"duplicatesCollapsed":sum(max(0, len(g.get("alternates", []))) for g in duplicate_groups)}, {"routes":routes})

def normalize_path(path):
    p = str(path or "/").strip().strip('`')
    if not p.startswith("/") and not p.startswith("http") and not p.startswith("{{"):
        p = "/" + p
    p = re.sub(r"//+", "/", p)
    p = p.replace(":/", "://", 1) if p.startswith("http:/") else p
    p = re.sub(r"/:([A-Za-z_$][\w$]*)", r"/{\1}", p)
    p = re.sub(r"\[([^\]]+)\]", r"{\1}", p)
    return p or "/"

def route_id(method, path):
    path_id = path.strip("/").replace("/","-").replace("{","").replace("}","").replace(":","") or "root"
    path_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", path_id).strip("-") or "root"
    return f"{method.lower()}-{path_id}"

def source_score(rel):
    r = rel.lower()
    score = 100
    if "/src/" in "/" + r or r.startswith("src/"): score += 40
    if "/app/" in "/" + r or r.startswith("app/"): score += 30
    if "/pages/" in "/" + r or r.startswith("pages/"): score += 20
    if "/routes/" in "/" + r: score += 15
    if "/controllers/" in "/" + r: score += 10
    # These should already be ignored, but keep deterministic preference if user unignores them.
    bad = ["/dist/", "/build/", "/node_modules/", "/test/", "/tests/", "/fixtures/", "/examples/"]
    for b in bad:
        if b in "/" + r:
            score -= 100
    return score

def canonicalize_routes(raw_routes):
    grouped = {}
    for r in raw_routes:
        key = (r["method"], r["path"])
        grouped.setdefault(key, []).append(r)
    routes=[]; duplicate_groups=[]
    for (method, path), items in sorted(grouped.items(), key=lambda x: (x[0][1], x[0][0])):
        best = sorted(items, key=lambda x: (-int(x.get("sourceScore",0)), len(x.get("file") or ""), int(x.get("line") or 0)))[0]
        alternates = [i for i in items if i is not best]
        rid=route_id(method, path)
        route={
            "id":rid,
            "method":method,
            "path":path,
            "file":best.get("file"),
            "line":best.get("line"),
            "handler":best.get("handler",""),
            "call":best.get("call",""),
            "parser":best.get("parser","balanced_or_nextjs"),
            "canonical": True,
            "duplicateSourceCount": len(items),
            "alternateSources": [{"file": a.get("file"), "line": a.get("line"), "sourceScore": a.get("sourceScore")} for a in alternates[:25]],
        }
        routes.append(route)
        if alternates:
            duplicate_groups.append({"method":method,"path":path,"canonical":{"file":route["file"],"line":route["line"]},"alternates":route["alternateSources"],"totalSources":len(items)})
    return routes, duplicate_groups

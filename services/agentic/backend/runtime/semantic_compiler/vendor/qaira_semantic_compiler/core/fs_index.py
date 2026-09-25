from __future__ import annotations
from pathlib import Path
from typing import Dict, List, Any
import fnmatch
from qaira_semantic_compiler.core.ignore import QAIgnore

class RepositoryIndex:
    def __init__(self, source: Path, config: Dict[str, Any]):
        self.source = Path(source)
        self.config = config or {}
        scan = self.config.get("scan") or {}
        self.ignore = QAIgnore.load(self.source, self.config)
        self.include_ext = set(scan.get("include_extensions", []))
        self.max_size = int(scan.get("max_file_size_kb", 4096)) * 1024
        self.files: List[Path] = []
        self.text_files: List[Path] = []
        self.by_name: Dict[str, List[str]] = {}
        self.by_stem: Dict[str, List[str]] = {}
        self.by_kind: Dict[str, List[str]] = {
            "routes": [], "controllers": [], "services": [], "schemas": [], "dtos": [], "repositories": []
        }
        self.ignored: List[Dict[str, str]] = []
        self.skipped_large: List[str] = []
        self.skipped_extension: List[str] = []

    def skip(self, p: Path):
        ignored, reason = self.ignore.match(p)
        if ignored:
            if len(self.ignored) < 10000:
                self.ignored.append({"path": self.rel(p), "reason": reason})
            return True
        if p.is_file():
            if self.include_ext and p.suffix not in self.include_ext:
                if len(self.skipped_extension) < 1000:
                    self.skipped_extension.append(self.rel(p))
                return True
            try:
                if p.stat().st_size > self.max_size:
                    if len(self.skipped_large) < 1000:
                        self.skipped_large.append(self.rel(p))
                    return True
            except Exception:
                return True
        return False

    def rel(self, p: Path) -> str:
        try:
            return str(p.relative_to(self.source)).replace("\\", "/")
        except Exception:
            return str(p).replace("\\", "/")

    def build(self):
        # Prune ignored directories manually rather than relying only on rglob post-filtering.
        stack = [self.source]
        while stack:
            current = stack.pop()
            try:
                children = list(current.iterdir())
            except Exception:
                continue
            for p in children:
                if self.skip(p):
                    continue
                if p.is_dir():
                    stack.append(p)
                    continue
                if not p.is_file():
                    continue
                rel = self.rel(p)
                self.files.append(p)
                self.text_files.append(p)
                self.by_name.setdefault(p.name.lower(), []).append(rel)
                self.by_stem.setdefault(p.stem.lower(), []).append(rel)
                stem = p.stem.lower(); rel_l = rel.lower()
                if any(x in stem for x in ["route", "routes"]) or "/routes/" in rel_l or "/app/api/" in rel_l:
                    self.by_kind["routes"].append(rel)
                if any(x in stem for x in ["controller", "controllers"]) or "/controllers/" in rel_l:
                    self.by_kind["controllers"].append(rel)
                if "service" in stem or "/services/" in rel_l:
                    self.by_kind["services"].append(rel)
                if any(x in stem for x in ["schema", "validator", "validation"]):
                    self.by_kind["schemas"].append(rel)
                if "dto" in stem:
                    self.by_kind["dtos"].append(rel)
                if "repository" in stem or "/repositories/" in rel_l or "/repository/" in rel_l:
                    self.by_kind["repositories"].append(rel)
        return self

    def read(self, rel):
        return (self.source / rel).read_text(encoding="utf-8", errors="ignore")

    def resolve_module(self, from_file: str, module: str):
        if not module:
            return ""
        base = (self.source / from_file).parent
        exts = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"]
        if module.startswith("."):
            raw = (base / module).resolve()
            candidates = [raw] + [Path(str(raw)+e) for e in exts] + [raw/"index.js", raw/"index.ts", raw/"index.tsx"]
            for c in candidates:
                if c.exists() and c.is_file() and not self.skip(c):
                    try:
                        return str(c.relative_to(self.source)).replace("\\", "/")
                    except Exception:
                        return str(c)
        stem = Path(module).name.lower()
        keys = [stem, stem+".js", stem+".ts", stem+".tsx", stem+".jsx"]
        for k in keys:
            vals = self.by_name.get(k) or self.by_stem.get(k)
            if vals:
                return sorted(vals, key=lambda x: (0 if "/services/" in "/"+x else 1, len(x)))[0]
        return ""

    def summary(self):
        ignored_by_reason = {}
        for item in self.ignored:
            ignored_by_reason[item["reason"]] = ignored_by_reason.get(item["reason"], 0) + 1
        return {
            "fileCount": len(self.files),
            "byKind": {k: len(v) for k, v in self.by_kind.items()},
            "names": len(self.by_name),
            "ignore": {
                "ignoredCount": len(self.ignored),
                "ignoredByPattern": ignored_by_reason,
                "sampleIgnored": self.ignored[:200],
                "patternSummary": self.ignore.summary(),
                "skippedLargeCount": len(self.skipped_large),
                "skippedByExtensionCount": len(self.skipped_extension),
            }
        }

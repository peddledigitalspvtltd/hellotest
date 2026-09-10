from __future__ import annotations
from pathlib import Path
from typing import Iterable, List, Tuple, Dict, Any
import fnmatch, os

DEFAULT_QAIGNORE = """
# QAira ignore file. Gitignore-like patterns used by API and WebUI/QSG extractors.
# Keep generated/vendor/test/build artifacts out of semantic extraction to avoid inflated counts.

# Dependencies and package caches
node_modules/
vendor/
.pnpm-store/
.yarn/
.npm/

# Build/generated outputs
dist/
build/
out/
.next/
.nuxt/
.svelte-kit/
coverage/
.nyc_output/
.cache/
.turbo/
.vercel/
public/build/

# QAira output/learning folders
qaira-output/
qaira-learning/
.qaira/

# VCS and OS artifacts
.git/
.svn/
.hg/
__MACOSX/
.DS_Store
._*

# Tests, fixtures, examples and generated declaration/map files
# These are ignored for route/UI extraction by default because they frequently contain framework fixtures.
test/
tests/
__tests__/
fixtures/
fixture/
examples/
example/
*.test.*
*.spec.*
*.stories.*
*.mock.*
*.d.ts
*.map

# Common lock/minified/bundle outputs
package-lock.json
yarn.lock
pnpm-lock.yaml
*.min.js
*.bundle.js
""".strip() + "\n"

class QAIgnore:
    def __init__(self, root: Path, patterns: Iterable[str] | None = None):
        self.root = Path(root).resolve()
        self.patterns: List[str] = []
        self.negations: List[str] = []
        for line in patterns or []:
            p = self._clean(line)
            if not p:
                continue
            if p.startswith('!'):
                n = self._clean(p[1:])
                if n:
                    self.negations.append(n)
            else:
                self.patterns.append(p)

    @classmethod
    def load(cls, root: Path, config: Dict[str, Any] | None = None) -> 'QAIgnore':
        root = Path(root)
        lines: List[str] = []
        # Built-in defaults always apply, so users are protected even without a .qaignore file.
        lines.extend(DEFAULT_QAIGNORE.splitlines())
        scan = (config or {}).get('scan') or {}
        for d in scan.get('exclude_dirs', []) or []:
            lines.append(str(d).rstrip('/') + '/')
        for f in scan.get('exclude_files', []) or []:
            lines.append(str(f))
        custom = scan.get('ignore_file') or '.qaignore'
        candidates = []
        if custom:
            cp = Path(custom)
            candidates.append(cp if cp.is_absolute() else root / cp)
        candidates.append(root / '.qaignore')
        # When running from source/image, package-level template is a fallback only.
        try:
            package_root = Path(__file__).resolve().parents[3]
            candidates.append(package_root / '.qaignore')
            candidates.append(package_root / 'config' / '.qaignore')
        except Exception:
            pass
        seen = set()
        for c in candidates:
            c = Path(c)
            key = str(c.resolve()) if c.exists() else str(c)
            if key in seen:
                continue
            seen.add(key)
            if c.exists() and c.is_file():
                try:
                    lines.extend(c.read_text(encoding='utf-8', errors='ignore').splitlines())
                except Exception:
                    pass
        return cls(root, lines)

    def _clean(self, line: str) -> str:
        line = (line or '').strip()
        if not line or line.startswith('#'):
            return ''
        return line.replace('\\', '/')

    def rel(self, path: Path) -> str:
        try:
            return str(Path(path).resolve().relative_to(self.root)).replace('\\', '/')
        except Exception:
            try:
                return str(Path(path).relative_to(self.root)).replace('\\', '/')
            except Exception:
                return str(path).replace('\\', '/')

    def match(self, path: Path) -> Tuple[bool, str]:
        rel = self.rel(path).strip('/')
        if not rel:
            return False, ''
        ignored, reason = False, ''
        for pat in self.patterns:
            if self._matches(rel, pat):
                ignored, reason = True, pat
        if ignored:
            for pat in self.negations:
                if self._matches(rel, pat):
                    return False, 'unignored:' + pat
        return ignored, reason

    def is_ignored(self, path: Path) -> bool:
        return self.match(path)[0]

    def _matches(self, rel: str, pat: str) -> bool:
        rel = rel.strip('/')
        pat = pat.strip()
        if not pat:
            return False
        dir_pat = pat.endswith('/')
        p = pat.strip('/')
        parts = rel.split('/')
        base = parts[-1]
        if dir_pat:
            return p in parts or rel.startswith(p + '/') or fnmatch.fnmatch(rel + '/', p + '/') or fnmatch.fnmatch(rel + '/', '**/' + p + '/')
        if '/' in p:
            return fnmatch.fnmatch(rel, p) or fnmatch.fnmatch(rel, p.lstrip('/')) or fnmatch.fnmatch(rel, '**/' + p)
        return fnmatch.fnmatch(base, p) or any(fnmatch.fnmatch(part, p) for part in parts) or fnmatch.fnmatch(rel, p)

    def summary(self) -> Dict[str, Any]:
        return {"patternCount": len(self.patterns), "negationCount": len(self.negations), "patterns": self.patterns, "negations": self.negations}

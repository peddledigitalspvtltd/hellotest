from __future__ import annotations
from pathlib import Path
import os, subprocess, json
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.qsg import GraphKernel, GraphEmitter
from qaira_semantic_compiler.qsg.parsers import ParserContext, iter_source_files, default_plugins

class QsgBuildAgent:
    name = "QsgBuildAgent"
    def __init__(self, ctx, logger): self.ctx=ctx; self.logger=logger
    def run(self):
        qsg_cfg = self.ctx.config.get("qsg", {}) or {}
        db_rel = qsg_cfg.get("db_path", "graph/qsg.sqlite")
        db_path = self.ctx.output / db_rel
        kernel = GraphKernel(db_path, ontology_version=qsg_cfg.get("ontology_version", "1.0.0"))
        commit_sha = git_sha(self.ctx.source)
        kernel.begin_transaction(commit_sha=commit_sha, repository_id=qsg_cfg.get("snapshot_repository_id", "local-workspace"))
        emit = GraphEmitter(kernel)
        parser_ctx = ParserContext(self.ctx.source)
        plugins = default_plugins(qsg_cfg.get("parsers", {}))
        files_seen = 0; parse_hits = {p.name: 0 for p in plugins}; errors=[]
        for sf in iter_source_files(self.ctx.source, self.ctx.config):
            files_seen += 1
            for p in plugins:
                try:
                    if p.supports(sf):
                        p.parse(parser_ctx, sf, emit)
                        parse_hits[p.name] += 1
                except Exception as e:
                    errors.append({"parser": p.name, "file": sf.rel, "error": str(e)})
        kernel.finalize(); kernel.commit()
        dump = kernel.dump_json(); summary = kernel.summary(); kernel.close()
        self.ctx.state["qsg_db_path"] = str(db_path)
        self.ctx.state["qsg_summary"] = summary
        self.ctx.write_json("graph/qsg.json", dump)
        self.ctx.write_json("graph/qsg_summary.json", {**summary, "filesSeen": files_seen, "parserHits": parse_hits, "rejectedWrites": emit.rejected, "parserErrors": errors})
        return AgentResult(self.name, "success" if summary["nodeCount"] else "partial", 0.92 if summary["nodeCount"] else 0.35, {"nodes":summary["nodeCount"],"edges":summary["edgeCount"],"files":files_seen}, {"dbPath":str(db_path)})

def git_sha(path: Path) -> str:
    try:
        p = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5)
        if p.returncode == 0: return p.stdout.strip()
    except Exception: pass
    return "local"

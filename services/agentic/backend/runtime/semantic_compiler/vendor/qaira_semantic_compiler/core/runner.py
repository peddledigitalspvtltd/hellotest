from __future__ import annotations
from qaira_semantic_compiler.core.context import AgentResult
from qaira_semantic_compiler.core.agent_contracts import RobustAgentMixin
import time, traceback, signal, os, json, hashlib


class TimeoutError(Exception):
    pass


class AgentRunner:
    """Production runner used by both old API agents and new QRIP/WebUI agents.

    Capabilities:
    - config-based agent enable/disable
    - Git and LLM guardrails
    - per-agent timeout
    - retries with backoff
    - fail-open fallback
    - trace.jsonl spans
    - per-agent result files
    - learning memory snapshots
    - output artifact existence validation
    """
    def __init__(self, ctx, logger):
        self.ctx = ctx
        self.logger = logger

    def _timeout(self, signum, frame):
        raise TimeoutError("agent timeout")

    def is_llm_agent(self, agent_name: str) -> bool:
        return "LLM" in agent_name or "Advisor" in agent_name or "Reviewer" in agent_name

    def is_enabled(self, agent_name: str) -> tuple[bool, str]:
        cfg = self.ctx.config or {}
        disabled = set(((cfg.get("agents") or {}).get("disabled") or []))
        if agent_name in disabled:
            return False, "disabled_by_agents.disabled"

        # Git agents are never allowed unless both agents.git.enabled and specific option are true.
        git_agents = {
            "SourceRepoCloneAgent": "checkout",
            "GitFinalizationAgent": "finalization",
            "GitPushAgent": "push",
            "PullRequestAgent": "pull_request",
        }
        if agent_name in git_agents:
            g = ((cfg.get("agents") or {}).get("git") or {})
            if not bool(g.get("enabled", False)):
                return False, "git_agents_disabled"
            if not bool(g.get(git_agents[agent_name], False)):
                return False, f"git_{git_agents[agent_name]}_disabled"
            if agent_name == "SourceRepoCloneAgent":
                co = ((cfg.get("source") or {}).get("checkout") or {})
                if not bool(co.get("enabled", False)) or not str(co.get("repo_url", "")).strip():
                    return False, "source_checkout_disabled_or_missing_repo_url"

        # LLM agents run only when key exists and llm.enabled permits it.
        if self.is_llm_agent(agent_name):
            llm = cfg.get("llm") or {}
            enabled = str(llm.get("enabled", "auto")).lower()
            has_key = bool(os.environ.get(llm.get("api_key_env", "OPENAI_API_KEY")) or os.environ.get("OPENAI_API_KEY"))
            if enabled in {"false", "0", "no"}:
                return False, "llm_disabled_by_config"
            if enabled == "auto" and not has_key:
                return False, "llm_auto_without_OPENAI_API_KEY"
            if enabled in {"true", "1", "yes"} and not has_key and bool(llm.get("require_key", True)):
                return False, "llm_enabled_but_OPENAI_API_KEY_missing"

        return True, "enabled"

    def skipped(self, agent, reason: str):
        name = agent.name
        result = AgentResult(name=name, status="skipped", confidence=1.0, metrics={"skipped": True, "reason": reason}, outputs={}).finish()
        self.logger.log("SKIP", name, reason)
        self.ctx.append_jsonl("runtime/agent_progress.jsonl", {"event":"skipped", "agent":name, "reason":reason, "status":result.status, "outputs":result.outputs, "metrics":result.metrics})
        self.ctx.results.append(result)
        self.ctx.write_json(f"agents/{name}/result.json", result.to_dict())
        self.ctx.append_jsonl("runtime/agent_results.jsonl", result.to_dict())
        self.write_outcome(result, skipped=True, reason=reason)
        return result

    def normalize_result(self, agent_name: str, result):
        if isinstance(result, AgentResult):
            return result
        if isinstance(result, dict):
            return AgentResult(name=agent_name, status=result.get("status", "success"), confidence=float(result.get("confidence", 0.75)), metrics=result.get("metrics", {}), outputs=result.get("outputs", result))
        return AgentResult(name=agent_name, status="success", confidence=0.8, outputs={"raw": result})

    def validate_artifacts(self, result: AgentResult):
        missing = []
        for key, value in (result.outputs or {}).items():
            if isinstance(value, str) and ("/" in value or value.endswith((".json", ".js", ".ts", ".sqlite", ".md"))):
                if not (self.ctx.output / value).exists() and not value.startswith("/:"):
                    missing.append(value)
        if missing:
            result.metrics.setdefault("missingOutputHints", missing)
            if result.status == "success":
                result.status = "partial"
        return result

    def write_learning(self, result: AgentResult):
        learning_cfg = (self.ctx.config.get("learning") or {})
        if not bool(learning_cfg.get("enabled", True)):
            return
        safe = {
            "name": result.name,
            "status": result.status,
            "confidence": result.confidence,
            "metrics": result.metrics,
            "outputs": result.outputs,
            "ended_at": result.ended_at,
        }
        self.ctx.write_learning_json(f"agents/{result.name}.latest.json", safe)


    def write_outcome(self, result: AgentResult, skipped: bool=False, reason: str=""):
        outcome = {
            "agent": result.name,
            "status": result.status,
            "confidence": result.confidence,
            "seconds": (result.metrics or {}).get("seconds", 0),
            "attempt": (result.metrics or {}).get("attempt", 0),
            "inputFingerprint": (result.metrics or {}).get("inputFingerprint", ""),
            "outputFingerprint": (result.metrics or {}).get("outputFingerprint", ""),
            "artifactChecks": (result.metrics or {}).get("artifactChecks", []),
            "fallbackUsed": result.status in {"failed_open", "partial"},
            "fallbackReason": reason or (result.errors[0].get("message") if result.errors else ""),
            "qualitySignals": {"missingOutputHints": (result.metrics or {}).get("missingOutputHints", [])},
            "errorClass": (result.metrics or {}).get("errorClass", ""),
            "skipped": skipped,
        }
        self.ctx.append_jsonl("runtime/agent_outcomes.jsonl", outcome)
        self.ctx.append_jsonl("runtime/quality_signals.jsonl", {"agent": result.name, "status": result.status, "confidence": result.confidence, **outcome.get("qualitySignals", {})})
        return outcome

    def run(self, agent):
        name = agent.name
        enabled, reason = self.is_enabled(name)
        if not enabled:
            return self.skipped(agent, reason)

        runtime = self.ctx.config.get("runtime") or {}
        timeout = int(runtime.get("agent_timeout_seconds", 900))
        fail_open = bool(runtime.get("fail_open", True))
        retries = int(runtime.get("retries", 1))
        backoff = float(runtime.get("retry_backoff_seconds", 1))
        attempts = 1 + max(0, retries)
        last_error = None
        started_total = time.time()
        span_id, span_start = self.logger.span_start(name, attempts=attempts, timeout=timeout)

        for attempt in range(1, attempts + 1):
            started = time.time()
            old = None
            try:
                old = signal.signal(signal.SIGALRM, self._timeout)
                if timeout > 0:
                    signal.alarm(timeout)
                input_fp = agent.input_fingerprint() if hasattr(agent, "input_fingerprint") else ""
                self.ctx.append_jsonl("runtime/agent_progress.jsonl", {"event":"started", "agent":name, "attempt":attempt, "inputFingerprint": input_fp})
                self.logger.log("START", name, "attempt started", attempt=attempt)
                result = self.normalize_result(name, agent.run())
                result.metrics = result.metrics or {}
                result.metrics.update({"attempt": attempt, "seconds": round(time.time() - started, 3), "inputFingerprint": input_fp})
                if hasattr(agent, "output_fingerprint"):
                    result.metrics["outputFingerprint"] = agent.output_fingerprint()
                if hasattr(agent, "artifact_checks"):
                    result.metrics["artifactChecks"] = agent.artifact_checks()
                result.finish()
                result = self.validate_artifacts(result)
                self.logger.log("END", name, "completed", status=result.status, confidence=result.confidence, seconds=result.metrics.get("seconds"), attempt=attempt)
                self.ctx.append_jsonl("runtime/agent_progress.jsonl", {"event":"completed", "agent":name, "attempt":attempt, "status":result.status, "confidence":result.confidence, "metrics":result.metrics, "outputs":result.outputs, "artifacts":result.artifacts})
                self.ctx.results.append(result)
                self.ctx.write_json(f"agents/{name}/result.json", result.to_dict())
                self.ctx.append_jsonl("runtime/agent_results.jsonl", result.to_dict())
                self.write_learning(result)
                self.write_outcome(result)
                self.logger.span_end(name, span_id, span_start, status=result.status)
                return result
            except Exception as e:
                last_error = e
                self.logger.error(name, e)
                if attempt < attempts:
                    wait = backoff * attempt
                    self.ctx.append_jsonl("runtime/agent_progress.jsonl", {"event":"retry", "agent":name, "attempt":attempt, "nextAttempt":attempt+1, "waitSeconds":wait, "error":str(e)})
                    self.logger.log("RETRY", name, "retrying after failure", attempt=attempt, nextAttempt=attempt+1, waitSeconds=wait, error=str(e))
                    time.sleep(wait)
                else:
                    if not fail_open:
                        self.logger.span_end(name, span_id, span_start, status="failed")
                        raise
            finally:
                try:
                    signal.alarm(0)
                    if old is not None:
                        signal.signal(signal.SIGALRM, old)
                except Exception:
                    pass

        result = AgentResult(
            name=name,
            status="failed_open" if fail_open else "failed",
            confidence=0.0,
            errors=[{"message": str(last_error), "traceback": traceback.format_exc()}],
            metrics={"attempts": attempts, "seconds": round(time.time() - started_total, 3), "errorClass": classify_error(last_error)}
        ).finish()
        self.ctx.append_jsonl("runtime/agent_progress.jsonl", {"event":"failed_open", "agent":name, "status":result.status, "metrics":result.metrics, "errors":result.errors})
        self.ctx.results.append(result)
        self.ctx.write_json(f"agents/{name}/result.json", result.to_dict())
        self.ctx.append_jsonl("runtime/agent_results.jsonl", result.to_dict())
        self.write_learning(result)
        self.write_outcome(result, reason=str(last_error))
        self.logger.span_end(name, span_id, span_start, status=result.status)
        return result


def classify_error(exc):
    text=str(exc or "").lower()
    if "timeout" in text: return "timeout"
    if "permission" in text or "denied" in text: return "permission"
    if "no such file" in text or "not found" in text: return "missing_artifact"
    if "json" in text or "decode" in text: return "parse_error"
    if "network" in text or "connection" in text: return "network"
    return exc.__class__.__name__ if exc else "unknown"

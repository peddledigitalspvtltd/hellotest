from __future__ import annotations
from pathlib import Path
import json, datetime, traceback, re, uuid, time

SECRET_PATTERNS = [
    re.compile(r"(OPENAI_API_KEY|api[_-]?key|x-api-key|authorization|bearer|token|password|secret)\s*[:=]\s*['\"]?[^'\"\s,}]+", re.I),
    re.compile(r"sk-[A-Za-z0-9_\-]{20,}")
]


def ts():
    return datetime.datetime.utcnow().isoformat() + "Z"


class Logger:
    def __init__(self, output: Path, console=True):
        self.output = Path(output)
        self.console_enabled = console
        (self.output / "verbose").mkdir(parents=True, exist_ok=True)
        self.run_id = "run-" + uuid.uuid4().hex[:12]

    def redact(self, text: str) -> str:
        text = str(text)
        for pat in SECRET_PATTERNS:
            def repl(m):
                if len(m.groups()) >= 1:
                    return f"{m.group(1)}=<redacted>"
                return "<redacted>"
            text = pat.sub(repl, text)
        return text

    def _write(self, payload):
        with (self.output / "verbose" / "trace.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, default=str) + "\n")

    def log(self, level, stage, message, **kwargs):
        safe_kwargs = json.loads(self.redact(json.dumps(kwargs, default=str))) if kwargs else {}
        payload = {"ts": ts(), "runId": self.run_id, "level": level, "stage": stage, "service.name":"qaira-semantic-compiler", "qaira.phase": stage, "message": self.redact(str(message)), **safe_kwargs}
        self._write(payload)
        if self.console_enabled:
            extra = f" {json.dumps(safe_kwargs, default=str)[:700]}" if safe_kwargs else ""
            print(f"[Qaira][{level}] {stage}: {payload['message']}{extra}", flush=True)

    def error(self, stage, exc):
        self.log("ERROR", stage, str(exc), traceback=self.redact(traceback.format_exc()[-8000:]))

    def span_start(self, stage, **kwargs):
        span_id = "span-" + uuid.uuid4().hex[:10]
        self.log("SPAN_START", stage, "started", spanId=span_id, traceId=self.run_id, **kwargs)
        return span_id, time.time()

    def span_end(self, stage, span_id, started, **kwargs):
        self.log("SPAN_END", stage, "completed", spanId=span_id, traceId=self.run_id, seconds=round(time.time() - started, 3), **kwargs)

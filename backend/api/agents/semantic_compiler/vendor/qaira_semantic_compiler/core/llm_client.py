from __future__ import annotations
import json, os, time, urllib.request, re, hashlib
from pathlib import Path

class LLMClient:
    """Fail-open, budgeted, redacted LLM gateway.

    Network execution is off unless explicitly enabled. Prompts/responses are always saved so the pipeline remains auditable.
    """
    def __init__(self, ctx, logger):
        self.ctx=ctx
        self.logger=logger
        self.cfg=(ctx.config.get("llm_review") or ctx.config.get("llm") or {})
        self.counter_path=ctx.output/"llm"/"call_count.json"

    def can_call(self):
        max_calls=int(self.cfg.get("calls_per_run", self.cfg.get("max_calls_per_run", 1)))
        count=0
        if self.counter_path.exists():
            try: count=json.loads(self.counter_path.read_text()).get("count",0)
            except Exception: count=0
        return count < max_calls, count, max_calls

    def inc_call(self):
        ok,count,max_calls=self.can_call()
        self.counter_path.parent.mkdir(parents=True,exist_ok=True)
        self.counter_path.write_text(json.dumps({"count":count+1,"maxCalls":max_calls}),encoding="utf-8")

    def review(self, name, payload, default=None, schema=None, purpose="semantic_review"):
        default=default or {"accepted":True,"suggestions":[],"reason":"llm_fail_open_default"}
        enabled=str(self.cfg.get("enabled","auto")).lower() in {"true","1","yes","on"}
        execute=bool(self.cfg.get("execute_network_calls",False))
        max_chars=int(self.cfg.get("max_prompt_chars",16000))
        ok,count,max_calls=self.can_call()
        payload_safe=redact_obj(payload)
        prompt={
            "instruction": (
                "You are a deterministic QAira semantic-agent reviewer. Return JSON only. "
                "Do not reveal chain of thought. Validate evidence, risks, fallback options, and deterministic remediations. "
                "Output keys: accepted, score, issues, missingEvidence, guardrailViolations, suggestedAgentDeltas, retryAdvice."
            ),
            "purpose":purpose,
            "name":name,
            "schema":schema or {},
            "payload":payload_safe
        }
        prompt_json=safe_json_dumps(prompt)[:max_chars]
        prompt_hash=hashlib.sha256(prompt_json.encode()).hexdigest()
        self.ctx.write_json(f"llm/prompts/{safe_name(name)}.{prompt_hash[:10]}.json", prompt)
        self.ctx.append_jsonl("llm/llm_calls.jsonl", {"name":name,"purpose":purpose,"promptHash":prompt_hash,"enabled":enabled,"executeNetworkCalls":execute,"callCount":count,"maxCalls":max_calls})
        if not enabled or not execute:
            return self._save(name, {**default,"llmEnabled":enabled,"networkCallExecuted":False,"promptHash":prompt_hash,"reason":"prompt_recorded_network_disabled","callCount":count,"maxCalls":max_calls})
        if not ok:
            return self._save(name, {**default,"llmEnabled":True,"networkCallExecuted":False,"promptHash":prompt_hash,"reason":"llm_call_budget_exhausted","callCount":count,"maxCalls":max_calls})
        api_key=os.environ.get(self.cfg.get("api_key_env","OPENAI_API_KEY"),"") or os.environ.get("OPENAI_API_KEY","")
        if not api_key:
            return self._save(name,{**default,"llmEnabled":True,"networkCallExecuted":False,"promptHash":prompt_hash,"error":"missing_api_key"})
        endpoint=self.cfg.get("endpoint","https://api.openai.com/v1/chat/completions")
        model=self.cfg.get("model","gpt-4.1-mini")
        retries=int(self.cfg.get("max_retries",1)); timeout=int(self.cfg.get("timeout_seconds",25))
        for attempt in range(retries+1):
            try:
                body=safe_json_dumps({"model":model,"temperature":0,"response_format":{"type":"json_object"},"messages":[{"role":"system","content":"Return valid JSON only. No markdown. No hidden reasoning."},{"role":"user","content":prompt_json}]}).encode("utf-8")
                req=urllib.request.Request(endpoint,data=body,headers={"Content-Type":"application/json","Authorization":"Bearer "+api_key})
                with urllib.request.urlopen(req,timeout=timeout) as resp:
                    data=json.loads(resp.read().decode("utf-8",errors="replace"))
                self.inc_call()
                content=data.get("choices",[{}])[0].get("message",{}).get("content","")
                self.ctx.write_text(f"llm/raw/{safe_name(name)}.{prompt_hash[:10]}.txt", content)
                parsed=parse_llm_json(content)
                parsed.update({"networkCallExecuted":True,"parseSafe":True,"promptHash":prompt_hash,"model":model})
                return self._save(name,parsed)
            except Exception as e:
                self.logger.log("LLM-ERROR",name,str(e),attempt=attempt)
                if "429" in str(e) or "401" in str(e) or "403" in str(e): break
                time.sleep(1+attempt)
        return self._save(name,{**default,"llmEnabled":True,"networkCallExecuted":False,"promptHash":prompt_hash,"error":"llm_failed_or_rate_limited","failOpen":True})

    def _save(self,name,result):
        self.ctx.write_json(f"llm/responses/{safe_name(name)}.json", result)
        self.ctx.append_jsonl("llm/llm_results.jsonl", {"name":name, **result})
        return result

def redact_obj(obj):
    try: return json.loads(redact_text(json.dumps(obj, default=str)))
    except Exception: return redact_text(str(obj))

def redact_text(text):
    text=str(text)
    patterns=[r"sk-[A-Za-z0-9_\-]{20,}", r"(?i)(authorization|bearer|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,}\]]+"]
    for p in patterns: text=re.sub(p, "<redacted>", text)
    return text

def safe_json_dumps(obj): return json.dumps(obj, ensure_ascii=False, default=str)

def parse_llm_json(text):
    if not text: return {"accepted":True,"suggestedAgentDeltas":[],"reason":"empty_llm_text_fail_open"}
    try: return normalize(json.loads(text))
    except Exception:
        cleaned=text.strip(); cleaned=re.sub(r"^```(?:json)?","",cleaned,flags=re.I).strip(); cleaned=re.sub(r"```$","",cleaned).strip()
        start=cleaned.find("{"); end=cleaned.rfind("}")
        if start>=0 and end>start:
            try: return normalize(json.loads(cleaned[start:end+1]))
            except Exception as e: return {"accepted":True,"suggestedAgentDeltas":[],"reason":"malformed_json_fail_open","parseError":str(e),"rawPreview":cleaned[:1000]}
    return {"accepted":True,"suggestedAgentDeltas":[],"reason":"no_json_found_fail_open","rawPreview":text[:1000]}

def normalize(data):
    if not isinstance(data,dict): return {"accepted":True,"suggestedAgentDeltas":[],"reason":"non_object_fail_open","raw":data}
    data.setdefault("accepted",True); data.setdefault("suggestedAgentDeltas",data.get("suggestions",[])); data.setdefault("issues",[]); data.setdefault("score",80); data.setdefault("reason","llm_review_completed")
    return data

def safe_name(s): return re.sub(r"[^a-zA-Z0-9_.-]+","_",str(s))[:120]

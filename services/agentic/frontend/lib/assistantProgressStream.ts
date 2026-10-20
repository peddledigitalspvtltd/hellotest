export type AgentProgress = {
  contract_type: "AgentProgress" | "RetrievalEvent";
  contract_version: string;
  session_id?: string;
  phase?: string;
  stage?: string;
  message?: string;
  progress?: number;
};

/** Only checked progress and the final schema-validated result leave the server. */
export async function consumeAssistantProgress<T>(response: Response, onProgress?: (event: AgentProgress) => void, signal?: AbortSignal): Promise<T> {
  if (!response.body) throw new Error("The review stream is unavailable. Check review history before retrying.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", name = "message", data: string[] = [], size = 0;
  let result: T | undefined;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, {once:true});
  const active = () => { if(signal?.aborted) throw new DOMException("Review stopped", "AbortError"); };
  const dispatch = () => {
    if(!data.length) { name="message"; return; }
    if(!["progress","result","error"].includes(name)) {name="message";data=[];size=0;return;}
    const value=JSON.parse(data.join("\n"));
    if(name === "error") throw Object.assign(new Error(value.message || "The review could not finish. Check review history before retrying."),{code:value.code});
    if(name === "progress") {
      if(value && ["AgentProgress","RetrievalEvent"].includes(value.contract_type) && typeof value.contract_version === "string") {
        onProgress?.(value);
      }
    }
    if(name === "result") {
      if(!value || typeof value !== "object" || !value.transaction?.id || !value.result) throw new Error("The review returned an invalid result.");
      result=value;
    }
    name="message";data=[];size=0;
  };
  const lines = (final=false) => {
    while(true) {
      const pos=buffer.indexOf("\n");
      if(pos<0) break;
      const line=buffer.slice(0,pos).replace(/\r$/,"");buffer=buffer.slice(pos+1);
      if(!line) {dispatch();continue;}
      if(line.startsWith(":")) continue;
      if(line.startsWith("event:")) name=line.slice(6).trim();
      if(line.startsWith("data:")) {const part=line.slice(5).replace(/^ /,"");size+=part.length;if(size>4*1024*1024) throw new Error("The review stream exceeded its supported size.");data.push(part);}
    }
    if(buffer.length>4*1024*1024) throw new Error("The review stream exceeded its supported size.");
    if(final) {if(buffer.startsWith("data:"))data.push(buffer.slice(5).trimStart());dispatch();}
  };
  try {
    active();
    while(true) {const chunk=await reader.read();active();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});lines();}
    buffer+=decoder.decode();lines(true);active();
    if(!result) throw new Error("The review connection ended before completion. Check review history before retrying.");
    return result;
  } finally {signal?.removeEventListener("abort",abort);await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}

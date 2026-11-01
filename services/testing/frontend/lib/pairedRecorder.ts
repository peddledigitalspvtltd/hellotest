import { probePairedLocalAgent } from "@hellotest/agentic/frontend/lib/pairedLocalAgent";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";

type PairedRecording = RecorderSessionResponse & { paired_recording_id: string; inspector_agent_token: string; engine_base_url: string };
const recordings = new Map<string, PairedRecording>();
const stopped = new Map<string, RecorderSessionResponse>();
type PrepareResponse = RecorderSessionResponse & { paired_session_payload: Record<string, unknown>; paired_recording_id: string };

async function agentJson<T>(agent: { publicBaseUrl: string; token: string }, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${agent.publicBaseUrl}${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "omit", headers: { "Content-Type": "application/json", "X-HelloTest-Agent-Token": agent.token }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || "The paired browser recorder could not complete this action. Check Local agent setup and retry.");
  return result as T;
}

export async function startPairedRecording(prepare: () => Promise<PrepareResponse>): Promise<RecorderSessionResponse> {
  const agent = await probePairedLocalAgent();
  const prepared = await prepare();
  const session = await agentJson<RecorderSessionResponse>(agent, "/api/v1/recorder/sessions", prepared.paired_session_payload);
  const connected: PairedRecording = { ...session, recorder_mode: "local", purpose: "automation-recording", paired_recording_id: prepared.paired_recording_id, transaction_id: prepared.transaction_id, engine_base_url: agent.publicBaseUrl, inspector_agent_token: agent.token, status_url: `${agent.publicBaseUrl}/api/v1/recorder/sessions/${encodeURIComponent(session.id)}`, live_view_url: session.live_view_path ? `${agent.publicBaseUrl}${session.live_view_path}` : session.live_view_url };
  recordings.set(session.id, connected);
  return connected;
}

export async function finishPairedRecording<T>(sessionId: string, save: (capture: { paired_recording_id: string; captured_session: RecorderSessionResponse }) => Promise<T>) {
  const session = recordings.get(sessionId);
  if (!session) throw new Error("This paired recording is unavailable in this browser tab. Return to the tab where you started it before saving.");
  let capture = stopped.get(sessionId);
  if (!capture) {
    capture = await agentJson<RecorderSessionResponse>({ publicBaseUrl: session.engine_base_url, token: session.inspector_agent_token }, `/api/v1/recorder/sessions/${encodeURIComponent(sessionId)}/stop`, {});
    stopped.set(sessionId, capture);
  }
  const result = await save({ paired_recording_id: session.paired_recording_id, captured_session: capture });
  recordings.delete(sessionId); stopped.delete(sessionId);
  return result;
}

export function isPairedRecording(sessionId: string) { return recordings.has(sessionId); }

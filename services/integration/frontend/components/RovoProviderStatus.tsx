import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconPlugConnected, IconSparkles } from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { openHelloTestRovo, testHelloTestRovoConnection } from "../lib/rovo";
import "./RovoProviderStatus.css";

export function RovoProviderStatus({
  className = "",
  compact = false,
  prompt = "Help me review the current HelloTest quality-engineering context."
}: {
  className?: string;
  compact?: boolean;
  prompt?: string;
}) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const canView = hasPermission(session, "agentic_workflow.view", projectId);
  const [message, setMessage] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const connection = useQuery({
    queryKey: ["native-agent-connection", projectId, session?.user.id, canView],
    queryFn: ({ signal }) => testHelloTestRovoConnection({ projectId, canView, signal }),
    enabled: Boolean(session),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false
  });
  const status = connection.isFetching ? "checking" : connection.data?.available ? "available" : "unavailable";

  const handleOpen = async () => {
    if (status !== "available") return;
    setIsOpening(true);
    setMessage("");
    try {
      await openHelloTestRovo(prompt);
    } catch {
      setMessage("Unable to open the workflow studio. Check your workspace connection and try again.");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className={["rovo-provider-status", compact ? "is-compact" : "", className].filter(Boolean).join(" ")}>
      <span className="rovo-provider-mark" aria-hidden="true"><IconSparkles size={15} stroke={2} /></span>
      <div className="rovo-provider-copy" aria-live="polite">
        <strong>HelloTest QA Agent</strong>
        <span>{status === "checking" ? "Checking access to the current project's workflow studio…" : connection.data?.summary || "Workspace access has not been verified."}</span>
        {status !== "checking" && connection.data ? <small>{connection.data.detail}</small> : null}
        {message ? <small role="status">{message}</small> : null}
      </div>
      <span className={`count-pill rovo-provider-state is-${status}`}>{status === "checking" ? "Checking" : status === "available" ? "Workspace available" : "Unavailable"}</span>
      <div className="rovo-provider-actions">
        <button aria-label="Test QA Agent connection" className="ghost-button compact" disabled={connection.isFetching || !session} onClick={() => { setMessage(""); void connection.refetch(); }} type="button">
          <IconPlugConnected size={14} aria-hidden="true" />{connection.isFetching ? "Testing…" : "Test connection"}
        </button>
        <button className="ghost-button compact" disabled={status !== "available" || isOpening} onClick={() => void handleOpen()} type="button">
          {isOpening ? "Opening…" : "Open agent"}
        </button>
      </div>
      {connection.data && status !== "checking" ? <small className="rovo-provider-checked">Checked {new Date(connection.data.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {connection.data.latency_ms} ms · Workspace access only</small> : null}
    </div>
  );
}

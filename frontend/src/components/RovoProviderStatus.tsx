import { useEffect, useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { openQairaRovo, isQairaRovoAvailable } from "../lib/rovo";

type RovoStatus = "checking" | "available" | "unavailable";

export function RovoProviderStatus({
  className = "",
  compact = false,
  prompt = "Help me review the current HelloTest quality-engineering context."
}: {
  className?: string;
  compact?: boolean;
  prompt?: string;
}) {
  const [status, setStatus] = useState<RovoStatus>("checking");
  const [message, setMessage] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let active = true;
    void isQairaRovoAvailable().then((available) => {
      if (active) setStatus(available ? "available" : "unavailable");
    });
    return () => { active = false; };
  }, []);

  const handleOpen = async () => {
    setIsOpening(true);
    setMessage("");
    try {
      await openQairaRovo(prompt);
    } catch (error) {
      setStatus("unavailable");
      setMessage(error instanceof Error ? error.message : "Unable to open the HelloTest agent workspace.");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className={["rovo-provider-status", compact ? "is-compact" : "", className].filter(Boolean).join(" ")}>
      <span className="rovo-provider-mark" aria-hidden="true"><IconSparkles size={15} stroke={2} /></span>
      <div>
        <strong>HelloTest QA Agent</strong>
        <span>
          {status === "checking"
            ? "Checking native agent availability…"
            : status === "available"
              ? "Available in this workspace. Opens the governed agentic workflow studio with this review context."
              : "Not enabled for this workspace or user. Other governed LLM providers and deterministic fallbacks remain available."}
        </span>
        {message ? <small role="status">{message}</small> : null}
      </div>
      <span className={`count-pill rovo-provider-state is-${status}`}>{status === "checking" ? "Checking" : status === "available" ? "Available" : "Unavailable"}</span>
      <button
        className="ghost-button compact"
        disabled={status !== "available" || isOpening}
        onClick={() => void handleOpen()}
        type="button"
      >
        {isOpening ? "Opening…" : "Open agent"}
      </button>
    </div>
  );
}

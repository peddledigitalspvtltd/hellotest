import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

export function WorkflowCodeView({code, filename}: {code: string; filename: string}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setCopied(false); setError(""); }, [code, filename]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setError(""); }
    catch { setError("Select and copy the code from the editor."); }
  };
  return <div className="studio-json-editor studio-code-editor">
    <div className="studio-json-toolbar"><span>{filename} · Playwright</span><button type="button" onClick={() => void copy()} aria-label="Copy Playwright code">{copied ? <IconCheck size={14} /> : <IconCopy size={14} />}{copied ? "Copied" : "Copy code"}</button></div>
    <textarea aria-label="Executable Playwright code" spellCheck={false} readOnly wrap="off" value={code} />
    {error && <p role="status">{error}</p>}
  </div>;
}

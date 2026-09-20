import { IconActivityHeartbeat } from "@tabler/icons-react";
import "./EntityHealthRibbon.css";

export function EntityHealthButton({ entityType, entityName, onClick, disabled = false }: {
  entityType: "Sprint" | "Release" | "Module";
  entityName: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={`${entityType} Health: ${entityName}`}
      aria-haspopup="dialog"
      className="ghost-button compact entity-health-button"
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onClick(); }}
      title={`Review ${entityName} health and evidence`}
      type="button"
    >
      <IconActivityHeartbeat aria-hidden="true" size={16} stroke={1.8} />
      <span>{entityType} Health</span>
    </button>
  );
}

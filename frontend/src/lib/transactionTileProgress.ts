import type { WorkspaceTransaction } from "../types";

export function transactionTileProgress(transaction: Pick<WorkspaceTransaction, "metadata" | "status">, fallbackPercent: number) {
  const count = (key: string) => {
    const value = Number(transaction.metadata?.[key]);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  };
  const total = count("total_items") || count("total_rows");
  if (total > 0) {
    const failed = Math.min(total, count("failed"));
    const succeeded = Math.min(total - failed, Math.max(count("imported"), count("exported")));
    const processed = Math.min(total, Math.max(count("processed_items"), succeeded + failed));
    return {
      value: Math.round(processed / total * 100),
      breakdown: {
        total,
        segments: [
          { key: "passed", label: "Succeeded", count: succeeded },
          { key: "failed", label: "Failed", count: failed },
          { key: "unknown", label: "Processed without a recorded outcome", count: processed - succeeded - failed },
          { key: "pending", label: "Pending", count: total - processed }
        ]
      }
    };
  }

  const value = Number.isFinite(fallbackPercent) ? Math.max(0, Math.min(100, fallbackPercent)) : 0;
  return {
    value,
    breakdown: {
      total: 100,
      unit: "percent" as const,
      segments: [
        { key: "covered", label: "Progress", count: value },
        { key: "pending", label: "Remaining", count: 100 - value }
      ]
    }
  };
}

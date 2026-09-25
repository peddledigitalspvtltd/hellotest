import { LoadingState } from "../../shared/components/LoadingState";

export function WorkspacePageSkeleton({ label }: { label: string }) {
  return <LoadingState label={label} />;
}

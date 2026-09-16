import { LoadingState } from "./LoadingState";

export function WorkspacePageSkeleton({ label }: { label: string }) {
  return <LoadingState label={label} />;
}

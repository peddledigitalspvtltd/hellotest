import { LoadingState } from "./LoadingState";

// Keep existing call-site props while all catalog loading uses one overlay.
export function TileCardSkeletonGrid(_props: { className?: string; count?: number }) {
  return <LoadingState label="Loading tiles" />;
}

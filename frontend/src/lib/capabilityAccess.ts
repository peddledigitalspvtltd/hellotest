import type { FeatureFlagSnapshot, SessionPayload } from "../types";
import { arePermissionFeaturesEnabled } from "./featureFlags";
import { hasPermission } from "./permissions";

/** A configured grant and currently enabled product capability are independent. */
export function hasCapability(
  session: SessionPayload | null,
  snapshot: FeatureFlagSnapshot | null | undefined,
  permission: string,
  projectId?: string | null
) {
  return hasPermission(session, permission, projectId)
    && arePermissionFeaturesEnabled(snapshot, permission);
}

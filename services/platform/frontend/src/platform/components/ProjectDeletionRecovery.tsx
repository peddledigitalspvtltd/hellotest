import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useProjectDeletions } from "../hooks/useProjectDeletions";
import { ProjectDeletionProgress } from "./ProjectDeletionProgress";

/** A receipt remains accessible to its requester after memberships are removed.
 * This surface loads only tracked receipts; it grants no project/catalog access.
 */
export function ProjectDeletionRecovery() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const deletions = useProjectDeletions(session?.user.id || "", (deletedProjectId) => {
    if (projectId === deletedProjectId) setProjectId("");
    queryClient.removeQueries({ queryKey: ["projects", "detail", deletedProjectId] });
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
  });
  return <ProjectDeletionProgress deletions={deletions} />;
}

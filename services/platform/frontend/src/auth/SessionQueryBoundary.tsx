import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readRequestSession } from "../lib/httpClient";
import { useAuth } from "./AuthContext";

/** Prevent cached project data from rendering under a replacement identity. */
export function SessionQueryBoundary({ children }: { children: ReactNode }) {
  useAuth(); // Reconcile after verified identity/permission changes.
  const queryClient = useQueryClient();
  const revision = readRequestSession().revision;
  const [committedRevision, setCommittedRevision] = useState(revision);
  const previousRevision = useRef(revision);

  useLayoutEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    void queryClient.cancelQueries();
    queryClient.clear();
    setCommittedRevision(revision);
  }, [revision, queryClient]);

  if (committedRevision !== revision) return null;
  return <Fragment key={revision}>{children}</Fragment>;
}

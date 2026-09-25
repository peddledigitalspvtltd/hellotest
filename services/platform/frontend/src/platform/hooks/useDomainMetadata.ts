import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export function useDomainMetadata() {
  return useQuery({
    queryKey: ["domain-metadata"],
    queryFn: ({ signal }) => api.metadata.domain({ signal }),
    staleTime: 5 * 60_000,
    // Refresh after an administrator edits dropdown values in another tab.
    refetchOnWindowFocus: "always"
  });
}

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useDomainMetadata() {
  return useQuery({
    queryKey: ["domain-metadata"],
    queryFn: api.metadata.domain,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always"
  });
}

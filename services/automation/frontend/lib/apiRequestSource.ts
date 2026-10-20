import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";
import { parseApiRequestSource as parse } from "../../shared/apiRequestSource.mjs";

export function parseApiRequestSource(source: string): StepApiRequest {
  return parse(source) as StepApiRequest;
}

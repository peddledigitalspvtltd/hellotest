import { request } from "./httpClient";
import { requestAiWithShorterContext } from "./aiRequestContext";

export const requestAiPreview = <T extends object>(path: string, init: RequestInit) =>
  requestAiWithShorterContext<T>((nextInit) => request<T>(path, nextInit), init);

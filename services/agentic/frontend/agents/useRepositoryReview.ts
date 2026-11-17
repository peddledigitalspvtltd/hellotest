import { useMemo, useReducer, type SetStateAction } from "react";
import { RepositoryReviewInitial, RepositoryReviewReducer, type RepositoryReviewState as State } from "./repositoryReviewState";
import type { RepositoryReviewState } from "./repositoryReviewState";
export function useRepositoryReview(initialGroup: RepositoryReviewState["group"]) {
  const [state, dispatch] = useReducer(RepositoryReviewReducer, initialGroup, () => RepositoryReviewInitial(initialGroup));
  const setters = useMemo(() => ({
    setSourceType: (value: SetStateAction<State["sourceType"]>) => dispatch({ type: "field", key: "sourceType", value }),
    setFile: (value: SetStateAction<State["file"]>) => dispatch({ type: "field", key: "file", value }),
    setDragActive: (value: SetStateAction<State["dragActive"]>) => dispatch({ type: "field", key: "dragActive", value }),
    setRepositoryUrl: (value: SetStateAction<State["repositoryUrl"]>) => dispatch({ type: "field", key: "repositoryUrl", value }),
    setRef: (value: SetStateAction<State["ref"]>) => dispatch({ type: "field", key: "ref", value }),
    setIntegrationId: (value: SetStateAction<State["integrationId"]>) => dispatch({ type: "field", key: "integrationId", value }),
    setMessage: (value: SetStateAction<State["message"]>) => dispatch({ type: "field", key: "message", value }),
    setMessageTone: (value: SetStateAction<State["messageTone"]>) => dispatch({ type: "field", key: "messageTone", value }),
    setMessageArea: (value: SetStateAction<State["messageArea"]>) => dispatch({ type: "field", key: "messageArea", value }),
    setHistoryOpen: (value: SetStateAction<State["historyOpen"]>) => dispatch({ type: "field", key: "historyOpen", value }),
    setHistoryPage: (value: SetStateAction<State["historyPage"]>) => dispatch({ type: "field", key: "historyPage", value }),
    setGroup: (value: SetStateAction<State["group"]>) => dispatch({ type: "field", key: "group", value }),
    setSearch: (value: SetStateAction<State["search"]>) => dispatch({ type: "field", key: "search", value }),
    setPublicationFilter: (value: SetStateAction<State["publicationFilter"]>) => dispatch({ type: "field", key: "publicationFilter", value }),
    setPage: (value: SetStateAction<State["page"]>) => dispatch({ type: "field", key: "page", value }),
    setSelected: (value: SetStateAction<State["selected"]>) => dispatch({ type: "field", key: "selected", value }),
    setModuleId: (value: SetStateAction<State["moduleId"]>) => dispatch({ type: "field", key: "moduleId", value }),
    setAutomationStartUrl: (value: SetStateAction<State["automationStartUrl"]>) => dispatch({ type: "field", key: "automationStartUrl", value }),
    setDownloading: (value: SetStateAction<State["downloading"]>) => dispatch({ type: "field", key: "downloading", value }),
    setPublishReceipt: (value: SetStateAction<State["publishReceipt"]>) => dispatch({ type: "field", key: "publishReceipt", value }),
  }), []);
  return { ...state, ...setters, dispatch };
}

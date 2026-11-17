import { useMemo, useReducer, type SetStateAction } from "react";
import { QualityReviewInitial, QualityReviewReducer, type QualityReviewState as State } from "./qualityReviewState";
export function useQualityReview() {
  const [state, dispatch] = useReducer(QualityReviewReducer, undefined, () => QualityReviewInitial());
  const setters = useMemo(() => ({
    setPlan: (value: SetStateAction<State["plan"]>) => dispatch({ type: "field", key: "plan", value }),
    setReviewed: (value: SetStateAction<State["reviewed"]>) => dispatch({ type: "field", key: "reviewed", value }),
    setShowPolicy: (value: SetStateAction<State["showPolicy"]>) => dispatch({ type: "field", key: "showPolicy", value }),
    setShowHistory: (value: SetStateAction<State["showHistory"]>) => dispatch({ type: "field", key: "showHistory", value }),
    setTab: (value: SetStateAction<State["tab"]>) => dispatch({ type: "field", key: "tab", value }),
    setNotice: (value: SetStateAction<State["notice"]>) => dispatch({ type: "field", key: "notice", value }),
    setFormError: (value: SetStateAction<State["formError"]>) => dispatch({ type: "field", key: "formError", value }),
    setBaselineArtifact: (value: SetStateAction<State["baselineArtifact"]>) => dispatch({ type: "field", key: "baselineArtifact", value }),
    setDraftFinding: (value: SetStateAction<State["draftFinding"]>) => dispatch({ type: "field", key: "draftFinding", value }),
  }), []);
  return { ...state, ...setters, dispatch };
}

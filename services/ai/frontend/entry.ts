// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  AiReferenceImages: () => import('./components/AiReferenceImages'),
  AiLifecycleReview: () => import("./components/AiLifecycleReview"),
  AiCaseAuthoringModal: () => import("./components/AiCaseAuthoringModal"),
  AiDesignStudioModal: () => import("./components/AiDesignStudioModal"),
  AiInsightPreviewDialog: () => import("./components/AiInsightPreviewDialog"),
  TestCaseChangeImpactDialog: () => import("./components/TestCaseChangeImpactDialog"),
  StoryChangeImpactDialog: () => import("./components/StoryChangeImpactDialog"),
  AiAssurancePanel: () => import("./components/AiAssurancePanel"),
  DefectTriageDialog: () => import("./components/DefectTriageDialog"),
  DefectAiDraftWorkspace: () => import("./components/DefectAiDraftWorkspace"),
  StoryGroomingWorkspace: () => import("./components/StoryGroomingWorkspace"),
  StoryAiStudioShell: () => import("./components/StoryAiStudioShell"),
  StoryAiDraftInspector: () => import("./components/StoryAiStudioContent"),
  StoryAiStudioContent: () => import("./components/StoryAiStudioContent"),
};

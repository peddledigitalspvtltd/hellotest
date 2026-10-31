import {
  IconPlayerPlay,
  IconRobot,
  IconSparkles,
  IconCode,
  IconWorld,
  IconPlugConnected,
  IconDatabase,
  IconGitBranch,
  IconRepeat,
  IconArrowMerge,
  IconAdjustments,
  IconShieldExclamation,
  IconListDetails,
  IconFileCheck,
  IconTestPipe,
  IconClock,
  IconPlayerStop,
} from "@tabler/icons-react";
const icons: Record<string, typeof IconRobot> = {
  trigger: IconPlayerPlay,
  agent: IconRobot,
  llmAgent: IconSparkles,
  customAI: IconSparkles,
  repositoryAgent: IconCode,
  webAgent: IconWorld,
  apiAgent: IconWorld,
  apiTool: IconWorld,
  mcpTool: IconPlugConnected,
  knowledgeTool: IconDatabase,
  repositoryTool: IconCode,
  testOpsTool: IconTestPipe,
  condition: IconGitBranch,
  loop: IconRepeat,
  aggregator: IconArrowMerge,
  transform: IconAdjustments,
  dataOperation: IconListDetails,
  wait: IconClock,
  stop: IconPlayerStop,
  errorHandler: IconShieldExclamation,
  log: IconListDetails,
  output: IconFileCheck,
};
export function WorkflowNodeIcon({
  kind,
  size = 20,
}: {
  kind: string;
  size?: number;
}) {
  const Icon = icons[kind] || IconRobot;
  return <Icon size={size} stroke={1.7} aria-hidden="true" />;
}

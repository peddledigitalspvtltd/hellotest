export type HelloTestService = "platform" | "testing" | "knowledge" | "manual" | "dashboard" | "automation" | "agentic" | "chatbot" | "ai" | "trace" | "integration";

export type ServiceDefinition = {
  id: HelloTestService;
  envKey: string;
  matches: (pathname: string) => boolean;
};

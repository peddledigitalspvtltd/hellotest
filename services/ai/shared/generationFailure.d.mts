export const AI_FAILURE_MESSAGES: Readonly<Record<string, [string, string]>>;
export function resolveAiFailurePresentation(value: unknown, now?: number): { code: string; title: string; action: string; message: string; remainingSeconds: number };

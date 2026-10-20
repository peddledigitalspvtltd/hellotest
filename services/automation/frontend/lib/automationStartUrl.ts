/** A reviewed application URL must stay literal; never replace it with a demo or environment URL. */
export function automationStartUrlError(value: string, required: boolean): string {
  const text = value.trim();
  if (!text) return required ? "Enter the application Start URL before continuing." : "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return "Enter an HTTP or HTTPS Start URL without embedded credentials.";
    }
  } catch {
    return "Enter a complete HTTP or HTTPS Start URL.";
  }
  return "";
}

export function reviewedAutomationStartUrl(value: string, required: boolean): string | undefined {
  const error = automationStartUrlError(value, required);
  if (error) throw new Error(error);
  return value.trim() || undefined;
}

import { Card } from "@hellotest/platform/frontend/src/shared/components/Card";

export function AutomationRuntimeBoundary({ runtimes }: { runtimes: readonly string[] }) {
  const native = runtimes.filter(runtime => runtime === "android" || runtime === "ios");
  if (!native.length) return null;
  return <Card title="Native app automation" aria-label="Native automation capability" role="note"><p>{native.map(runtime => runtime === "ios" ? "iOS" : "Android").join(" and ")} steps use recorded or authored Appium selectors and execute on a configured device or device cloud. Automation Engineer can prepare these instructions from supplied evidence. Its live browser inspection and recovery loop applies to web pages.</p></Card>;
}

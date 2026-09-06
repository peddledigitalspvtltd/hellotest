export function mergeRepositoryEntries<T extends { id: string }>(current: T[] = [], saved: T[]) {
  const byId = new Map(saved.filter((entry) => entry?.id).map((entry) => [entry.id, entry]));
  current.forEach((entry) => { if (!byId.has(entry.id)) byId.set(entry.id, entry); });
  return [...byId.values()];
}

export function mergeInspectedFields<T extends { locator: string }>(current: T[], incoming: T[]) {
  const byLocator = new Map(current.map((field) => [field.locator, field]));
  incoming.forEach((field) => byLocator.set(field.locator, { ...byLocator.get(field.locator), ...field }));
  return [...byLocator.values()];
}

export function retainUnsavedInspectedFields<T extends { locator: string }>(current: T[], attempted: T[], failed: T[]) {
  const attemptedByLocator = new Map(attempted.map((field) => [field.locator, field]));
  const failedLocators = new Set(failed.map((field) => field.locator));
  return mergeInspectedFields(
    failed,
    current.filter((field) => !attemptedByLocator.has(field.locator)
      || failedLocators.has(field.locator)
      || JSON.stringify(field) !== JSON.stringify(attemptedByLocator.get(field.locator)))
  );
}

/** Confirm the screen first, then keep per-field failures available for retry. */
export async function persistRepositoryScreenBundle<TField, TEntry extends { id: string }>({
  fields,
  saveScreen,
  saveField
}: {
  fields: TField[];
  saveScreen: () => Promise<TEntry>;
  saveField: (field: TField, screen: TEntry) => Promise<TEntry>;
}) {
  const screen = await saveScreen();
  if (!screen?.id) throw new Error("The screen save was not confirmed. Retry before saving fields.");
  const results = await Promise.allSettled(fields.map(async (field) => {
    const entry = await saveField(field, screen);
    if (!entry?.id) throw new Error("The field save was not confirmed. Retry this field.");
    return entry;
  }));
  const saved: TEntry[] = [];
  const failed: Array<{ field: TField; message: string }> = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") saved.push(result.value);
    else failed.push({ field: fields[index], message: result.reason instanceof Error ? result.reason.message : "Unable to save this field." });
  });
  return { screen, saved, failed, attempted: fields };
}

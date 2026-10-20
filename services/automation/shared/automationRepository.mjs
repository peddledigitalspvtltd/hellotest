/** Pure repository projection shared by authoring and export; it never loads a compiler. */
export function buildAutomationRepositoryFields(objectRepository) {
    return objectRepository.filter((entry) => !entry.metadata?.merged_into_entry_id && Boolean(entry.locator) && entry.locator !== "__screen__" && entry.locator_intent !== "__screen__" && entry.metadata?.record_kind !== "screen" && entry.metadata?.object_name !== "__screen__")
        .map((entry) => {
        const metadata = entry.metadata || {};
        const screenName = String(metadata.screen_name || entry.page_key || "Screen").trim();
        const rawName = String(metadata.object_name || entry.locator_intent || entry.locator || "Field").trim();
        const objectName = rawName.startsWith(`${screenName}.`) ? rawName.slice(screenName.length + 1) || rawName : rawName;
        const aliases = [...new Set((Array.isArray(metadata.reference_aliases) ? metadata.reference_aliases : []).filter((alias) => typeof alias === "string").map(alias => alias.trim()).filter(Boolean))];
        return { id: entry.id, reference: `${screenName}.${objectName}`, aliases, locator: entry.locator, screenName, objectName, htmlTag: String(metadata.object_role || entry.locator_kind || "locator"), pageUrl: String(metadata.page_url || metadata.url_pattern || entry.page_url || entry.page_key || "") };
    });
}
export function preparePlaywrightRepository(repository = []) {
    const fields = buildAutomationRepositoryFields(repository);
    const objects = {};
    const repositoryIssues = {};
    const canonical = new Map();
    fields.forEach(field => {
        const key = field.reference.toLowerCase(), entry = canonical.get(key) || { reference: field.reference, locators: new Set() };
        entry.locators.add(field.locator);
        canonical.set(key, entry);
    });
    canonical.forEach((entry, key) => {
        if (entry.locators.size === 1)
            objects[entry.reference] = [...entry.locators][0];
        else
            repositoryIssues[key] = `Ambiguous repository reference ${entry.reference}. Save a unique canonical locator before exporting.`;
    });
    const historical = new Map();
    fields.forEach(field => field.aliases.forEach(alias => historical.set(alias.toLowerCase(), new Set([...(historical.get(alias.toLowerCase()) || []), field.locator]))));
    historical.forEach((locators, alias) => {
        if (canonical.has(alias))
            return;
        if (locators.size === 1)
            objects[alias] = [...locators][0];
        else
            repositoryIssues[alias] = `Ambiguous historical repository reference ${alias}. Use its unique canonical Screen.Field reference.`;
    });
    return { objects, repositoryIssues };
}

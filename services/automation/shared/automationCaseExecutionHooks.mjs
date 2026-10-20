/** A partial replay/export cannot claim to reproduce a case whose linked
 * setup/cleanup it has not loaded. Malformed legacy settings are not empty. */
export function hasConfiguredCaseExecutionHooks(input) {
    if (input === undefined || input === null || input === "") return false;
    let hooks = input;
    if (typeof hooks === "string") {
        if (!hooks.trim()) return false;
        try { hooks = JSON.parse(hooks); }
        catch { return true; }
    }
    return !Array.isArray(hooks) || hooks.length > 0;
}

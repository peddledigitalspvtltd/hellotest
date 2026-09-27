import { useMemo, useState } from "react";
import { buildAttributeLocator } from "../lib/repositoryLocators";

type Props = { dom?: string | null; ancestorDom?: string | null; locator: string; onUse: (locator: string) => void };
export function RepositoryLocatorBuilder({ dom, ancestorDom, locator, onUse }: Props) {
  const element = useMemo(() => {
    if (!dom || typeof DOMParser === "undefined") return null;
    return new DOMParser().parseFromString(dom, "text/html").body.firstElementChild;
  }, [dom]);
  const attributes = useMemo(() => Array.from(element?.attributes || []).filter(({ name, value }) =>
    value && !["value", "style", "srcdoc"].includes(name) && !name.startsWith("on") && !name.startsWith("data-hellotest")
  ).slice(0, 24), [element]);
  const [selected, setSelected] = useState<string[]>(() => attributes.filter(({ name }) => ["data-testid", "id", "aria-label", "name"].includes(name)).slice(0, 1).map(({ name }) => name));
  const [scope, setScope] = useState("");
  const [index, setIndex] = useState("");
  const [custom, setCustom] = useState(locator);
  const composed = buildAttributeLocator(element?.tagName || "*", attributes.filter(({ name }) => selected.includes(name)).map(({ name, value }) => [name, value]), scope, index === "" ? undefined : Number(index));
  return <fieldset className="repository-locator-builder">
    <legend>Build a locator</legend>
    <p>Combine captured attributes and a parent selector. Validate on the live page before saving.</p>
    {attributes.length ? <div className="repository-locator-attributes">{attributes.map(({ name, value }) => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, name] : current.filter((item) => item !== name))} /><span><b>{name}</b><code>{value}</code></span></label>)}</div> : <small>No element DOM captured. Enter a locator below or capture the field again.</small>}
    {element ? <><label><span>Parent CSS selector (optional)</span><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="form[data-testid='sign-in']" /></label><label><span>Match index (optional, starts at 0)</span><input type="number" min="0" step="1" value={index} onChange={(event) => setIndex(event.target.value)} placeholder="Prefer a unique selector" /></label><code className="repository-locator-preview">{composed}</code><button className="ghost-button compact" type="button" onClick={() => setCustom(composed)}>Use this combination</button></> : null}
    <label><span>Locator</span><textarea aria-label="Locator" rows={3} value={custom} onChange={(event) => setCustom(event.target.value)} spellCheck={false} /></label>
    <button className="primary-button compact" type="button" disabled={!custom.trim() || custom.trim() === locator} onClick={() => onUse(custom.trim())}>Apply locator</button>
    {dom ? <details><summary>Captured DOM section</summary><pre>{ancestorDom || dom}</pre></details> : null}
  </fieldset>;
}

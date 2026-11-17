import { useEffect, useMemo, useState } from "react";
import { buildAttributeLocator, buildSemanticRepositoryLocator, type RepositoryLocatorStrategy } from "../lib/repositoryLocators";

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
  const [strategy, setStrategy] = useState<RepositoryLocatorStrategy>("css");
  const [semanticValue, setSemanticValue] = useState("");
  const [role, setRole] = useState("");
  useEffect(() => setCustom(locator), [locator]);
  useEffect(() => {
    setSelected(attributes.filter(({ name }) => ["data-testid", "id", "aria-label", "name"].includes(name)).slice(0, 1).map(({ name }) => name));
    setScope(""); setIndex(""); setStrategy("css"); setSemanticValue(""); setRole("");
  }, [attributes]);
  const chooseStrategy = (next: RepositoryLocatorStrategy) => {
    setStrategy(next);
    const values = Object.fromEntries(attributes.map(attribute => [attribute.name, attribute.value]));
    setSemanticValue(next === "testid" ? values["data-testid"] || "" : next === "placeholder" ? values.placeholder || "" : next === "xpath" ? "" : values["aria-label"] || element?.textContent?.trim() || "");
    const inputRole = ({checkbox:"checkbox",radio:"radio",button:"button",submit:"button",reset:"button",search:"searchbox",text:"textbox",email:"textbox",tel:"textbox",url:"textbox",number:"spinbutton"} as Record<string,string>)[values.type || "text"] || "";
    setRole(values.role || (element?.tagName === "BUTTON" ? "button" : element?.tagName === "A" && values.href ? "link" : element?.tagName === "INPUT" ? inputRole : element?.tagName === "TEXTAREA" ? "textbox" : element?.tagName === "SELECT" ? element.hasAttribute("multiple") || Number(element.getAttribute("size")) > 1 ? "listbox" : "combobox" : ""));
  };
  let composed = "", combinationError = "";
  try { composed = strategy === "css" ? buildAttributeLocator(element?.tagName || "*", attributes.filter(({ name }) => selected.includes(name)).map(({ name, value }) => [name, value]), scope, index === "" ? undefined : Number(index)) : buildSemanticRepositoryLocator(strategy, semanticValue, role, index === "" ? undefined : Number(index)); }
  catch (error) { combinationError = error instanceof Error ? error.message : "Invalid locator combination."; }
  return <fieldset className="repository-locator-builder">
    <legend>Build a locator</legend>
    <p>Prefer a test ID or accessible name. Validate one exact match on the live page before saving.</p>
    <label><span>Locator strategy</span><select aria-label="Locator strategy" value={strategy} onChange={event => chooseStrategy(event.target.value as RepositoryLocatorStrategy)}><option value="css">Captured attributes (CSS)</option><option value="testid">Test ID</option><option value="role">Accessible role and name</option><option value="label">Label</option><option value="text">Visible text</option><option value="placeholder">Placeholder</option><option value="xpath">XPath</option></select></label>
    {strategy === "css" ? attributes.length ? <div className="repository-locator-attributes">{attributes.map(({ name, value }) => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, name] : current.filter((item) => item !== name))} /><span><b>{name}</b><code>{value}</code></span></label>)}</div> : <small>No element DOM captured. Enter a locator below or capture the field again.</small> : <>{strategy === "role" ? <label><span>Accessible role</span><input value={role} onChange={event => setRole(event.target.value)} placeholder="button" /></label> : null}<label><span>{strategy === "role" ? "Accessible name" : strategy === "xpath" ? "XPath expression" : "Exact captured value"}</span><input value={semanticValue} onChange={event => setSemanticValue(event.target.value)} /></label></>}
    {element || strategy !== "css" ? <>{strategy === "css" ? <label><span>Parent CSS selector (optional)</span><input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="form[data-testid='sign-in']" /></label> : null}<label><span>Match index (optional, starts at 0)</span><input type="number" min="0" step="1" value={index} onChange={(event) => setIndex(event.target.value)} placeholder="Prefer a unique selector" /></label>{index !== "" ? <small>An index selects by position and can hide duplicate matches. Prefer an unambiguous name or stable attribute.</small> : null}{combinationError ? <p role="alert">{combinationError}</p> : <code className="repository-locator-preview">{composed}</code>}<button className="ghost-button compact" type="button" disabled={Boolean(combinationError)} onClick={() => setCustom(composed)}>Use this combination</button></> : null}
    <label><span>Locator</span><textarea aria-label="Locator" rows={3} value={custom} onChange={(event) => setCustom(event.target.value)} spellCheck={false} /></label>
    <button className="primary-button compact" type="button" disabled={!custom.trim() || custom.trim() === locator} onClick={() => onUse(custom.trim())}>Apply locator</button>
    {dom ? <details><summary>Captured DOM section</summary><pre>{ancestorDom || dom}</pre></details> : null}
  </fieldset>;
}

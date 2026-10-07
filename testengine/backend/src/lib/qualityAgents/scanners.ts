import type { Page, Response } from "playwright";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { AxeResults } from "axe-core";
import { QualityError, safeText } from "./contracts.js";
import type { QualityFinding } from "../../contracts/qualityAgents.js";
export type ScanResult = { findings: QualityFinding[]; metrics: Record<string, number | string | boolean | null>; limitations: string[] };

export async function scanSecurity(page: Page, response: Response | null): Promise<ScanResult> {
  const findings: QualityFinding[] = [];
  const headers = await response?.allHeaders() || {};
  const https = new URL(page.url()).protocol === "https:";
  const add = (id: string, title: string, description: string, evidence: string, recommendation: string, severity: QualityFinding["severity"] = "low") => findings.push({ id, category: "security_posture", severity, title, description, evidence, recommendation });
  if (!https) add("security-transport", "Page uses unencrypted HTTP", "Transport encryption is absent for this navigation.", "Observed page protocol: HTTP.", "Use HTTPS in shared and production environments.", "medium");
  if (!headers["content-security-policy"]) add("security-csp", "Content Security Policy is missing", "No enforcing CSP header was present on the main document response.", "content-security-policy: absent.", "Define a CSP suited to the application and test it in report-only mode before enforcement.");
  else if (/unsafe-inline|unsafe-eval/i.test(headers["content-security-policy"])) add("security-csp-relaxed", "Content Security Policy permits unsafe execution", "The enforcing policy contains unsafe-inline or unsafe-eval.", "An unsafe execution directive was observed; the full policy is omitted.", "Replace unsafe directives with nonces, hashes and a reviewed script policy.");
  if (https && !headers["strict-transport-security"]) add("security-hsts", "HSTS header is missing", "This HTTPS response did not advertise a strict transport policy.", "strict-transport-security: absent.", "Configure a reviewed HSTS policy for HTTPS deployments.");
  if (headers["x-content-type-options"]?.toLowerCase() !== "nosniff") add("security-nosniff", "MIME sniffing protection is missing", "The response did not contain X-Content-Type-Options: nosniff.", "Expected nosniff was not observed.", "Send X-Content-Type-Options: nosniff.");
  if (!headers["x-frame-options"] && !/frame-ancestors/i.test(headers["content-security-policy"] || "")) add("security-framing", "Frame embedding policy is missing", "No frame-ancestors directive or X-Frame-Options header was observed.", "Neither supported frame restriction was present.", "Set frame-ancestors to the application's intended embedding policy.");
  if (!headers["referrer-policy"]) add("security-referrer", "Referrer policy is not explicit", "The document response did not specify Referrer-Policy.", "referrer-policy: absent.", "Choose an explicit referrer policy appropriate to the application.");
  const cookies = await page.context().cookies();
  const secureMissing = cookies.filter(cookie => https && !cookie.secure).length;
  const httpOnlyMissing = cookies.filter(cookie => !cookie.httpOnly).length;
  if (secureMissing) add("security-cookie-secure", "Cookies lack the Secure attribute", "Some cookies observed in this isolated browser are not restricted to HTTPS.", `${secureMissing} of ${cookies.length} cookies lack Secure; names and values are omitted.`, "Review whether these cookies should be HTTPS-only.", "medium");
  if (httpOnlyMissing) add("security-cookie-httponly", "Review script-readable cookies", "Script access may be intentional; session cookies should normally be HttpOnly.", `${httpOnlyMissing} of ${cookies.length} cookies are script-readable; no session classification was inferred.`, "Review session cookie policy; client-side preferences may legitimately be readable.", "info");
  const mixed = await page.evaluate(() => location.protocol === "https:" ? [...document.querySelectorAll("script[src],img[src],link[href],iframe[src]")].filter(node => ((node as HTMLImageElement).src || (node as HTMLLinkElement).href).startsWith("http:")).length : 0);
  if (mixed) add("security-mixed-content", "Unencrypted resources are referenced", "The HTTPS DOM references HTTP resources; the browser may have blocked them.", `${mixed} HTTP resource references observed.`, "Serve referenced resources over HTTPS.", "medium");
  return { findings, metrics: { encrypted_transport: https, observed_cookies: cookies.length, policy_checks: 7, mixed_content_references: mixed }, limitations: ["Passive response and browser posture review only. No exploit, authenticated penetration or dependency vulnerability scan was performed.", "Cookie purpose and application authorization behavior were not inferred."] };
}

async function scanDomAccessibility(page: Page): Promise<ScanResult> {
  const evaluated = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const nodes = all.slice(0, 5000);
    const issues: Array<{ rule: string; title: string; description: string; evidence: string; selector?: string; severity: "low" | "medium" }> = [];
    const add = (rule: string, title: string, description: string, evidence: string, element?: Element, severity: "low" | "medium" = "medium") => {
      if (issues.length >= 100) return;
      const path: string[] = []; let current = element;
      for (let depth = 0; current && depth < 5; depth++, current = current.parentElement || undefined) {
        const name = current.tagName.toLowerCase(); const siblings = current.parentElement ? [...current.parentElement.children].filter(sibling => sibling.tagName === current!.tagName) : [current];
        path.unshift(`${name}:nth-of-type(${siblings.indexOf(current) + 1})`);
      }
      issues.push({ rule, title, description, evidence, ...(path.length ? { selector: path.join(" > ") } : {}), severity });
    };
    const named = (element: Element) => Boolean(element.getAttribute("aria-label")?.trim() || element.getAttribute("aria-labelledby")?.split(/\s+/).some(id => document.getElementById(id)?.textContent?.trim()) || element.getAttribute("title")?.trim() || element.textContent?.trim() || [...element.querySelectorAll("img[alt]")].some(image => image.getAttribute("alt")?.trim()));
    if (!document.title.trim()) add("document-title", "Document title is empty", "A descriptive title helps identify this page in tabs and assistive technology.", "document.title is empty.");
    if (!document.documentElement.lang.trim()) add("html-lang", "Document language is missing", "Screen readers need the page's primary language.", "The html element has no lang value.");
    const ids = new Set<string>(); let contrastChecks = 0, previousHeading = 0;
    const rgb = (value: string) => { const values = value.match(/[\d.]+/g)?.map(Number); return values && values.length >= 3 && (values.length < 4 || values[3] === 1) ? values.slice(0, 3) : null; };
    const luminance = (color: number[]) => color.map(value => { const linear = value / 255; return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126,.7152,.0722][index], 0);
    for (const element of nodes) {
      const id = element.getAttribute("id"); if (id) { if (ids.has(id)) add("duplicate-id", "Duplicate DOM identifier", "Duplicate identifiers can break label and ARIA relationships.", "An identifier appeared more than once; its value is omitted.", element); ids.add(id); }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || !element.getClientRects().length || element.closest('[aria-hidden="true"],[inert]')) continue;
      if (element.matches("img") && !element.hasAttribute("alt")) add("image-alt", "Image alternative text is missing", "Images require meaningful alternatives or an explicit empty alt for decoration.", "A visible img element has no alt attribute.", element);
      if (element.matches('button,a[href],[role="button"],[role="link"]') && !named(element)) add("control-name", "Interactive control has no accessible name", "Controls need a name that conveys their purpose.", "No text, ARIA label, title or image alternative was found.", element);
      if (element.matches('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea')) {
        const input = element as HTMLInputElement;
        if (!input.labels?.length && !element.getAttribute("aria-label")?.trim() && !element.getAttribute("aria-labelledby")?.split(/\s+/).some(id => document.getElementById(id)?.textContent?.trim())) add("input-label", "Form field has no associated label", "A placeholder alone does not label a form control.", "No associated label or populated ARIA label was found.", element);
      }
      if (element.matches('[role="button"],[role="link"]') && !element.matches("button,a[href],input") && (element as HTMLElement).tabIndex < 0) add("keyboard-target", "Custom interactive control is not keyboard focusable", "Custom controls need keyboard focus and suitable keyboard activation.", "An interactive ARIA role has a negative tabIndex.", element);
      if (/^H[1-6]$/.test(element.tagName)) { const level = Number(element.tagName[1]); if (previousHeading && level > previousHeading + 1) add("heading-order", "Heading hierarchy skips a level", "Review whether this heading expresses the intended document hierarchy.", `Heading level changes from ${previousHeading} to ${level}.`, element, "low"); previousHeading = level; }
      if (contrastChecks < 500 && [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) {
        const foreground = rgb(style.color); let parent: Element | null = element, background: number[] | null = null;
        while (parent && !background) { background = rgb(getComputedStyle(parent).backgroundColor); parent = parent.parentElement; }
        if (foreground && background && style.backgroundImage === "none") {
          contrastChecks++; const a=luminance(foreground), b=luminance(background), ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05), size=parseFloat(style.fontSize), large=size>=24||(size>=18.66&&Number(style.fontWeight)>=700), minimum=large?3:4.5;
          if (ratio < minimum) add("text-contrast", "Text contrast may be insufficient", "Computed solid colors are below the standard text contrast threshold; images and compositing need manual review.", `Computed contrast ${ratio.toFixed(2)}:1; expected ${minimum}:1.`, element);
        }
      }
    }
    return { issues, node_count: all.length, scanned_nodes: nodes.length, contrast_checks: contrastChecks };
  });
  return { findings: evaluated.issues.map((issue,index) => ({ id: `accessibility-${issue.rule}-${index}`, category: "accessibility", severity: issue.severity, title: issue.title, description: issue.description, evidence: issue.evidence, selector: issue.selector })), metrics: { check_engine: "bounded_dom", scanned_nodes: evaluated.scanned_nodes, total_dom_nodes: evaluated.node_count, solid_color_contrast_checks: evaluated.contrast_checks, reported_issues: evaluated.issues.length }, limitations: ["Bounded DOM heuristics, not axe-core or a WCAG conformance certification. Screen-reader behavior, keyboard activation, focus order and dynamic states require manual review.", "At most 5,000 elements, 500 solid-color text contrast checks and 100 issues are evaluated per page.", ...(evaluated.node_count>5000?["The DOM exceeded the scan bound; remaining elements were not evaluated."]:[])] };
}

let axeSource: Promise<string> | undefined;
export async function scanAccessibility(page: Page): Promise<ScanResult> {
  const count=await page.locator("*").count();
  let source:string;
  try { axeSource ||= readFile(createRequire(import.meta.url).resolve("axe-core/axe.min.js"),"utf8");source=await axeSource; }
  catch { const fallback=await scanDomAccessibility(page);fallback.metrics.check_engine="bounded_dom_fallback";fallback.metrics.needs_manual_review=true;fallback.limitations.unshift("axe-core could not be loaded. Only the disclosed bounded DOM fallback ran; this result requires review.");return fallback; }
  if(count>20000){const fallback=await scanDomAccessibility(page);fallback.metrics.check_engine="bounded_dom_fallback";fallback.metrics.needs_manual_review=true;fallback.limitations.unshift("The page exceeded the 20,000-element axe execution bound. Only the disclosed bounded DOM fallback ran.");return fallback;}
  await page.evaluate(source);
  const result=await page.evaluate(async()=>{
    const axe=(window as unknown as {axe:{run:(context:Document,options:unknown)=>Promise<AxeResults>}}).axe;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]},resultTypes:["violations","incomplete","passes","inapplicable"]}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("QUALITY_ACCESSIBILITY_TIMEOUT")),10000);})]);}
    finally{if(timer)clearTimeout(timer);}
  }).catch(error=>{if(String(error).includes("QUALITY_ACCESSIBILITY_TIMEOUT"))throw new QualityError("QUALITY_ACCESSIBILITY_TIMEOUT","axe-core exceeded its 10-second page analysis limit.",408);throw error;});
  const findings:QualityFinding[]=result.violations.slice(0,100).map(rule=>({id:`accessibility-${rule.id}`,category:"accessibility",severity:rule.impact==="critical"||rule.impact==="serious"?"high":rule.impact==="moderate"?"medium":"low",title:safeText(rule.help,240),description:safeText(rule.description,700),evidence:`axe-core ${result.testEngine.version}: ${rule.nodes.length} affected element(s). Rules: ${rule.tags.filter(tag=>tag.startsWith("wcag")).join(", ")}.`,selector:safeText(rule.nodes[0]?.target.map(part=>typeof part==="string"?part:part.join(" ")).join(" "),240),recommendation:`Review ${rule.helpUrl}`}));
  return {findings,metrics:{check_engine:"axe_core",axe_version:result.testEngine.version,scanned_nodes:count,violated_rules:result.violations.length,passed_rules:result.passes.length,incomplete_rules:result.incomplete.length,inapplicable_rules:result.inapplicable.length,needs_manual_review:result.incomplete.length>0},limitations:["axe-core evaluated WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tagged rules on the current page. Automated checks cannot determine complete WCAG conformance.","Keyboard journeys, screen-reader usability and application states require manual review. At most 20,000 elements, 100 reported violated rules and 10 seconds of rule execution are allowed.",...(result.incomplete.length?[`${result.incomplete.length} rule(s) require manual review; no automatic pass was assigned to these checks.`]:[]),...(result.violations.length>100?["Additional violations exceed the report bound and are not listed."]:[])]};
}

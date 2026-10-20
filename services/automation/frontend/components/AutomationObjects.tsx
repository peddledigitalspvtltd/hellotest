import type { ReactNode } from "react";
import type { AutomationLearningCacheEntry } from "@hellotest/platform/frontend/src/types";
import { SubnavTabs } from "@hellotest/platform/frontend/src/shared/components/SubnavTabs";
import "./AutomationObjects.css";

type Member = {entry:AutomationLearningCacheEntry;memberName:string;htmlTag:string;role:string;ref:string};
export type AutomationObjectPage = {screenName:string;pageName:string;url:string;members:Member[]};

/** The repository's screen/member layout, limited to this case's live bindings. */
export function AutomationObjects({pages,selectedScreen,selectedField,onSelectScreen,onSelectField,tab,onTabChange,overview,evidence,configuration,loading,error,onRetry,bindingsUnavailable = false}: {
  pages:AutomationObjectPage[];selectedScreen:string;selectedField:string;onSelectScreen:(key:string)=>void;onSelectField:(id:string,key:string)=>void;
  tab:"overview"|"fields"|"dom";onTabChange:(tab:"overview"|"fields"|"dom")=>void;overview:ReactNode;evidence:ReactNode;configuration:ReactNode;
  loading:boolean;error:boolean;onRetry:()=>void;bindingsUnavailable?:boolean;
}) {
  const active=pages.find(page=>page.screenName===selectedScreen) || pages[0];
  const selectedIsUsed=Boolean(active?.members.some(member=>member.entry.id===selectedField));
  return <section className="automation-repository-tab automation-case-objects" role="tabpanel" aria-label="Automation object bindings">
    <header className="automation-repository-tab-head"><div><h3>Object Repository</h3><p>Fields used by this case and their screens. Saved changes update the reusable repository.</p></div>{bindingsUnavailable ? <span>Bindings unavailable</span> : <span>{pages.length} screen{pages.length===1?"":"s"} · {pages.reduce((sum,page)=>sum+page.members.length,0)} fields</span>}</header>
    {bindingsUnavailable ? <div className="empty-state compact">Source access is required to determine which repository fields this case uses.</div> : null}
    {loading ? <p role="status">Loading repository fields…</p> : null}
    {error ? <div role="alert" className="empty-state compact">Repository fields could not be loaded.<button className="ghost-button compact" onClick={onRetry} type="button">Retry loading</button></div> : null}
    {!bindingsUnavailable && !loading && !error && !pages.length ? <div className="empty-state compact">No repository fields are used by this case. Reference a saved Screen.Field or locator in its instructions.</div> : null}
    {!bindingsUnavailable && !loading && !error && active ? <div className={`automation-workspace-grid automation-workspace-grid--repository automation-case-repository-grid${selectedIsUsed && configuration ? " has-config-drawer" : ""}`}>
      <div className="pom-workspace">
        <aside className="pom-page-list" aria-label="Repository pages used by this case">{pages.map(page=><div className={`pom-page-item${page.screenName===active.screenName?" is-active":""}`} key={page.screenName}><button className="pom-page-select" onClick={()=>onSelectScreen(page.screenName)} type="button"><strong>{page.pageName}</strong><small>{page.members.length} used field{page.members.length===1?"":"s"}</small></button></div>)}</aside>
        <section className="pom-class-panel" aria-label={`${active.pageName} repository page`}>
          <SubnavTabs ariaLabel="Screen details" className="object-repository-screen-tabs" value={tab} onChange={onTabChange} items={[{value:"overview",label:"Overview"},{value:"fields",label:"Fields",meta:String(active.members.length)},{value:"dom",label:"DOM Snapshot"}]}/>
          {tab==="fields" ? <div className="repository-fields-panel"><div className="pom-member-table"><div className="pom-member-row is-head"><span>Field</span><span>Type</span><span>Primary locator</span></div>{active.members.map(member=><button className={`pom-member-row${selectedField===member.entry.id?" is-active":""}`} key={member.entry.id} onClick={()=>onSelectField(member.entry.id,active.screenName)} type="button"><code>{member.memberName}</code><span>{member.htmlTag} · {member.role}</span><small>{member.entry.locator}</small></button>)}</div></div> : selectedScreen===active.screenName ? tab==="overview" ? overview : evidence : <p role="status">Loading screen…</p>}
        </section>
      </div>
      {selectedIsUsed ? configuration : null}
    </div> : null}
  </section>;
}

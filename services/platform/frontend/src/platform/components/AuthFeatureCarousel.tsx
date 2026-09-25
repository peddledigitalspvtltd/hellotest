import { useState } from "react";
import type { KeyboardEvent } from "react";
import { IconArrowLeft, IconArrowRight, IconChecklist, IconFileDescription, IconGitBranch, IconShieldCheck, IconSparkles, IconTestPipe, IconCheck, IconUsers, IconDatabase, IconAdjustments, IconPlugConnected, IconHistory } from "@tabler/icons-react";

const workspaceFeatures = [
  {
    key: "stories", label: "Story refinement", icon: IconFileDescription,
    title: "Start with a clearer Story.",
    description: "Use AI to refine scope, surface questions, and make acceptance criteria easier to review.",
    details: ["Grooming briefs", "Acceptance criteria", "Reviewed Smart Context"],
    footer: "From an idea to a shared understanding"
  },
  {
    key: "coverage", label: "Test design", icon: IconTestPipe,
    title: "Turn intent into coverage.",
    description: "Draft test cases from your Stories, then review the steps and expected outcomes with your team.",
    details: ["AI test case drafts", "Structured steps & Gherkin", "Linked Story coverage"],
    footer: "Keep the requirement behind every test"
  },
  {
    key: "execution", label: "Execution evidence", icon: IconChecklist,
    title: "Give every result context.",
    description: "Bring runs, failures, and supporting evidence together so your team can choose the next action.",
    details: ["Manual & automated runs", "Failure analysis", "Linked defects & evidence"],
    footer: "Follow the evidence from run to resolution"
  },
  {
    key: "readiness", label: "Release readiness", icon: IconShieldCheck,
    title: "Make readiness a review.",
    description: "Review coverage, execution results, and open risks before making your release decision.",
    details: ["Readiness checks", "Coverage & execution signals", "Evidence behind the decision"],
    footer: "A release decision your team can explain"
  },
  {
    key: "workflows", label: "Agent workflows", icon: IconGitBranch,
    title: "Build your team's QA flow.",
    description: "Configure agentic workflows for your QA tasks, with review checkpoints and results you can inspect.",
    details: ["Custom QA workflows", "Configurable agents & tools", "Reviewable workflow results"],
    footer: "Let AI help. Keep your team in control."
  }
];

const adminFeatures = [
  { key: "access", label: "Administrator access", icon: IconUsers,
    title: "Put the right people in control.", description: "Manage administrator accounts and review who can operate your HelloTest instance.",
    details: ["Administrator accounts", "Account status", "Security settings"], footer: "Clear ownership for the platform behind the work" },
  { key: "setup", label: "Instance setup", icon: IconDatabase,
    title: "Prepare the workspace for your team.", description: "Review schema readiness and manage sample content as you set up the instance.",
    details: ["Schema readiness", "Sample data setup", "Setup progress & results"], footer: "A clear starting point for your workspace" },
  { key: "policy", label: "Feature availability", icon: IconAdjustments,
    title: "Shape the tools your teams use.", description: "Manage available features and keep shared dropdown choices consistent across the product.",
    details: ["Feature policies", "Availability controls", "Shared dropdown values"], footer: "The right capabilities for the way your teams work" },
  { key: "integrations", label: "Backend integrations", icon: IconPlugConnected,
    title: "Keep your connected services organized.", description: "Configure the backend connections that support your workspace and its AI features.",
    details: ["Service connections", "Integration settings", "Active connection status"], footer: "Manage connections in one administration portal" },
  { key: "audit", label: "Audit activity", icon: IconHistory,
    title: "Keep important changes in view.", description: "Review recorded administrator activity across setup, accounts, feature policies, and integrations.",
    details: ["Recent admin activity", "Configuration changes", "Account security"], footer: "Context for the decisions behind the workspace" }
];

export function AuthFeatureCarousel({ audience = "workspace" }: { audience?: "workspace" | "admin" }) {
  const [active, setActive] = useState(0);
  const features = audience === "admin" ? adminFeatures : workspaceFeatures;
  const select = (index: number) => setActive((index + features.length) % features.length);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(event.key === "Home" ? 0 : event.key === "End" ? features.length - 1 : active + (event.key === "ArrowLeft" ? -1 : 1));
  };

  return (
    <section className="auth-showcase" aria-label="HelloTest product features" aria-roledescription="carousel"
      onKeyDown={onKeyDown}>
      <header className="auth-showcase-heading">
        <p className="auth-showcase-eyebrow"><IconSparkles size={16} aria-hidden="true" /> {audience === "admin" ? "HelloTest administration" : "Your team's quality workspace"}</p>
        {audience === "admin" ? <>
          <h1>Configure clearly.<br />Operate confidently.<br /><span>Keep teams moving.</span></h1>
          <p>Manage the people, capabilities, and connections<br className="auth-showcase-desktop-break" /> behind your HelloTest workspace.</p>
        </> : <>
          <h1>Ship faster.<br />Prove it's ready.<br /><span>Let AI do the rest.</span></h1>
          <p>From Story to release, connect the work and the evidence.<br className="auth-showcase-desktop-break" /> AI helps you move forward. Your team makes the call.</p>
        </>}
      </header>
      <div className="auth-coverflow">
        <div className="auth-coverflow-stage">
          {features.map((feature, index) => {
            const offset = ((index - active + features.length + 2) % features.length) - 2;
            const Icon = feature.icon;
            return (
              <article key={feature.key} className="auth-feature-card"
                data-position={offset} aria-hidden={offset !== 0} aria-roledescription="slide"
                aria-label={`${index + 1} of ${features.length}: ${feature.label}`}>
                <div className="auth-feature-card-top"><span className="auth-feature-icon"><Icon size={34} stroke={1.55} aria-hidden="true" /></span><span className="auth-feature-number">0{index + 1}</span></div>
                <p className="auth-feature-category">{feature.label}</p>
                <h2>{feature.title}</h2>
                <p className="auth-feature-description">{feature.description}</p>
                <ul>{feature.details.map(detail => <li key={detail}><IconCheck size={15} stroke={2} aria-hidden="true" />{detail}</li>)}</ul>
                <p className="auth-feature-footer">{feature.footer}</p>
              </article>
            );
          })}
        </div>
        <button className="auth-coverflow-arrow is-previous" type="button" aria-label="Previous feature" onClick={() => select(active - 1)}><IconArrowLeft size={20} aria-hidden="true" /></button>
        <button className="auth-coverflow-arrow is-next" type="button" aria-label="Next feature" onClick={() => select(active + 1)}><IconArrowRight size={20} aria-hidden="true" /></button>
      </div>
      <div className="auth-coverflow-navigation">
        <div className="auth-coverflow-dots" role="group" aria-label="Choose a feature">
          {features.map((feature, index) => <button key={feature.key} type="button" aria-label={`Show ${feature.label}`} aria-pressed={active === index} onClick={() => select(index)}><span /></button>)}
        </div>
      </div>
      <p className="auth-coverflow-status" aria-live="polite" aria-atomic="true">{String(active + 1).padStart(2, "0")} / 05 <span aria-hidden="true">·</span> {features[active].label}</p>
    </section>
  );
}

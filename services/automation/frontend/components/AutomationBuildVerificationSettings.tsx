import { resolveBuildVerificationChoice, type AutomationBuildVerificationChoice } from "../lib/automationBuildPipeline";

export function AutomationBuildVerificationSettings({mode,onModeChange,canVerify,interactive,disabled=false,hasEnvironment=false,browserLocation="remote",compact=false}: {
 mode:AutomationBuildVerificationChoice;onModeChange:(value:AutomationBuildVerificationChoice)=>void;canVerify:boolean;interactive:boolean;disabled?:boolean;hasEnvironment?:boolean;browserLocation?:"local"|"remote";compact?:boolean;
}) {
 const canRun=canVerify&&interactive,selected=resolveBuildVerificationChoice(mode,canRun,hasEnvironment,browserLocation);
 const usesCli=selected==="verify_cli"||selected==="verify_repair_cli",repairs=selected==="verify_repair"||selected==="verify_repair_cli";
 const description = compact
  ? (repairs ? "Runs the saved test again. Allows one observed locator correction before any interaction completes." : "Runs the saved test again in fresh Chromium.")
  : (repairs ? `Runs the saved web test${usesCli?" through Playwright Test CLI":""} in fresh Chromium with the same data. One observed locator correction may be retried before any interaction completes. Data, actions and expected results stay fixed.` : `Runs the saved web test once${usesCli?" through Playwright Test CLI":""} in fresh Chromium with the same data. This performs application actions again.`);
 return <label className="form-field"><span>After generating</span><select aria-label="After generating" value={selected} disabled={disabled} onChange={event=>onModeChange(event.target.value as AutomationBuildVerificationChoice)}>
  <option value="generate_only">Save instructions only</option><option value="verify" disabled={!canRun}>Run generated test</option><option value="verify_repair" disabled={!canRun}>Run with bounded locator repair</option>
  {browserLocation==="remote"?<option value="verify_cli" disabled={!canRun}>Run with Playwright Test CLI</option>:null}
  {browserLocation==="remote"?<option value="verify_repair_cli" disabled={!canRun}>Run CLI + bounded locator repair</option>:null}
 </select>{selected!=="generate_only" ? <small className="muted">{description}</small> : !compact ? <small className="muted">Saved instructions remain unverified until a test run passes.</small> : null}
 {!canVerify?<small className="muted">Verification requires local automation execution and run creation permissions.</small>:!interactive?<small className="muted">Choose “Perform steps in browser” to enable verification.</small>:null}</label>;
}

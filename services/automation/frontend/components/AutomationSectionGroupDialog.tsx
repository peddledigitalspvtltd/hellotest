import type { TestStep } from '@hellotest/platform/frontend/src/types';
import { LayersIcon } from '@hellotest/platform/frontend/src/platform/components/AppIcons';
import { richTextToPlainText } from '@hellotest/platform/frontend/src/platform/components/RichTextEditor';
import { StepParameterizedText } from '@hellotest/testing/frontend/components/StepParameterizedText';
import { AutomationOverlay } from './AutomationOverlay';
export type SectionGroupReview = { mode: 'group' | 'shared' | 'local' | 'ungroup'; stepIds: string[]; groupId?: string };
export function AutomationSectionGroupDialog({ review, sections, name, shared, busy, canCreateShared, error, parameterValues, onNameChange, onSharedChange, onClose, onSave }: {
  review: SectionGroupReview; sections: TestStep[]; name: string; shared: boolean; busy: boolean; canCreateShared: boolean; error?: string;
  parameterValues: Record<string,string>; onNameChange: (name:string)=>void; onSharedChange:(shared:boolean)=>void; onClose:()=>void; onSave:()=>void;
}) {
  const contiguous=sections.every((step,index)=>index===0||step.step_order===sections[index-1].step_order+1);
  const title=review.mode==='ungroup'?'Ungroup Sections':review.mode==='shared'?'Convert to Shared Section Group':review.mode==='local'?'Convert to Local Section Group':'Group Selected Sections';
  return <AutomationOverlay title={title} subtitle={`${sections.length} reviewed sections. Instructions, expected results and platform types are preserved.`} variant="dialog" icon={<LayersIcon size={20}/>} closeDisabled={busy} onClose={onClose}>
    {review.mode==='ungroup'?<p>The sections remain as independent sections. The reusable library group and saved execution snapshots are retained.</p>:<>
      <label className="form-field"><span>Group name</span><input autoFocus maxLength={255} onChange={event=>onNameChange(event.target.value)} value={name}/></label>
      {review.mode==='group'?<label className="checkbox-field"><input disabled={!canCreateShared} checked={shared} onChange={event=>onSharedChange(event.target.checked)} type="checkbox"/>Create a reusable Shared Section Group</label>:null}
      {review.mode==='local'?<p>This case becomes an independent local copy. The original shared library group is retained.</p>:null}
    </>}
    <ol>{sections.map(step=><li key={step.id}><StepParameterizedText text={richTextToPlainText(step.action||'Untitled section')} values={parameterValues}/></li>)}</ol>
    {!contiguous&&review.mode!=='ungroup'?<p role="alert">Grouping requires adjacent sections. Select a continuous range.</p>:null}
    {error?<p role="alert" className="automation-overlay-error">{error}</p>:null}
    <div className="automation-overlay-footer"><button className="ghost-button" disabled={busy} onClick={onClose} type="button">Cancel</button><button className="primary-button" disabled={busy||!sections.length||(review.mode!=='ungroup'&&(!contiguous||name.trim().length<2))} onClick={onSave} type="button">{busy?'Saving…':review.mode==='ungroup'?'Ungroup Sections':'Save Section Group'}</button></div>
  </AutomationOverlay>;
}

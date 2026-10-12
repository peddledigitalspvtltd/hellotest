import './TestCaseAiStudioModal.css';
export function AiTestCaseDraftFields({ section, title, description, descriptionText, priority, editing, disabled, onChange }: {
  section: 'title' | 'fields'; title: string; description?: string | null; descriptionText?: string; priority: number;
  editing: boolean; disabled?: boolean; onChange: (patch: { title?: string; description?: string; priority?: number }) => void;
}) {
  if (section === 'title') return editing ? <input aria-label="Test case title" disabled={disabled} maxLength={255} value={title} onChange={event => onChange({title:event.target.value})} /> : <h3>{title}</h3>;
  return editing ? <div className="ai-test-generator-draft-fields"><label>Description<textarea disabled={disabled} data-ai-auto-size rows={2} value={description || ''} onChange={event => onChange({description:event.target.value})} /></label><label>Priority<select disabled={disabled} value={priority} onChange={event => onChange({priority:Number(event.target.value)})}>{[1,2,3,4,5].map(value => <option key={value} value={value}>P{value}</option>)}</select></label></div> : description ? <p className="ai-test-generator-draft-description">{descriptionText ?? description}</p> : null;
}

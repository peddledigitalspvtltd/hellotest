import type {WorkflowOperationEditorProps} from '../operationEditorTypes';
/** Stateless fields preserve literal values; node-specific patches belong to the owning editor. */
export function workflowFieldInputs(data:WorkflowOperationEditorProps['data'],onChange:WorkflowOperationEditorProps['onChange']){
const field = (
    key: string,
    label: string,
    multiline = false,
    placeholder?: string,
  ) => (
    <label>
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={typeof data[key] === "object" && data[key] !== null ? JSON.stringify(data[key], null, 2) : String(data[key] ?? "")}
          aria-label={label}
          placeholder={placeholder}
          rows={5}
          spellCheck={false}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      ) : (
        <input
          value={String(data[key] ?? "")}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => onChange({ [key]: event.target.value })}
        />
      )}
    </label>
  );
const select = (
    key: string,
    label: string,
    options: Array<[string, string]>,
    fallback = "",
  ) => (
    <label>
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(data[key] || fallback)}
        onChange={(event) => onChange({ [key]: event.target.value })}
      >
        {options.map(([value, title]) => (
          <option value={value} key={value}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
const number = (key: string, label: string, min: number, max: number, fallback: number) => <label><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step={1} value={String(data[key] ?? fallback)} onChange={event => onChange({ [key]: event.target.value === "" ? "" : Number(event.target.value) })} /></label>;
const checkbox = (key: string, label: string, fallback = false) => <label className="studio-checkbox"><input type="checkbox" checked={typeof data[key] === "boolean" ? data[key] : fallback} onChange={event => onChange({ [key]: event.target.checked })} /><span>{label}</span></label>;
return {field,select,number,checkbox};
}

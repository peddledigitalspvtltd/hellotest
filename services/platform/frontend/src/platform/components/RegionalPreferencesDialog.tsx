import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "../../context/LocalizationContext";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { createRegionalFormatters } from "../lib/regionalPreferences";
export function RegionalPreferencesDialog({ onClose }: { onClose: () => void }) {
  const { t, preferences, setPreferences } = useLocalization();
  const [draft, setDraft] = useState(preferences);
  const dialogRef = useDialogFocus<HTMLDivElement>({ onClose });
  const preview = useMemo(() => createRegionalFormatters(draft), [draft]);
  const sample = useMemo(() => new Date(), []);
  const zones = [...new Set(["UTC", "Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", Intl.DateTimeFormat().resolvedOptions().timeZone, ...(preferences.timeZone === "auto" ? [] : [preferences.timeZone])])];
  const locales = [...new Set(["en-US", "en-GB", "en-IN", "es-ES", "fr-FR", "de-DE", "ja-JP", "ar-SA", ...(preferences.locale === "auto" ? [] : [preferences.locale])])];
  return createPortal(<div className="workspace-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="workspace-dialog regional-dialog" role="dialog" aria-modal="true" aria-labelledby="regional-title" aria-describedby="regional-description" tabIndex={-1} ref={dialogRef}>
      <header><div><span className="workspace-dialog-eyebrow">HelloTest · {t("shell.preferences", "Language & region")}</span><h2 id="regional-title">{t("regional.title", "Language & region")}</h2><p id="regional-description">{t("regional.description", "Personal preferences for this browser. Changes apply when you save.")}</p></div><button type="button" className="workspace-icon-button" onClick={onClose} aria-label={t("common.close", "Close")}>×</button></header>
      <form onSubmit={event => { event.preventDefault(); setPreferences(draft); onClose(); }}>
        <div className="regional-fields">
          <label>{t("regional.language", "Interface language")}<select aria-label={t("regional.language", "Interface language")} value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value as typeof draft.language })}><option value="workspace">{t("regional.workspace", "Workspace labels")}</option><option value="en">English</option><option value="es">Español</option></select></label>
          <label>{t("regional.locale", "Regional format")}<select aria-label={t("regional.locale", "Regional format")} value={draft.locale} onChange={event => setDraft({ ...draft, locale: event.target.value })}><option value="auto">{t("regional.browser", "Use browser setting")}</option>{locales.map(locale => <option key={locale}>{locale}</option>)}</select></label>
          <label>{t("regional.zone", "Time zone")}<select aria-label={t("regional.zone", "Time zone")} value={draft.timeZone} onChange={event => setDraft({ ...draft, timeZone: event.target.value })}><option value="auto">{t("regional.browser", "Use browser setting")}</option>{zones.map(zone => <option key={zone}>{zone}</option>)}</select></label>
          <label>{t("regional.clock", "Time format")}<select aria-label={t("regional.clock", "Time format")} value={draft.hourCycle} onChange={event => setDraft({ ...draft, hourCycle: event.target.value as typeof draft.hourCycle })}><option value="auto">{t("regional.browser", "Use browser setting")}</option><option value="h12">12 h</option><option value="h23">24 h</option></select></label>
        </div>
        <section className="regional-preview" aria-live="polite"><strong>{t("regional.preview", "Preview")}</strong><dl><div><dt>{t("regional.date", "Date & time")}</dt><dd><bdi>{preview.formatDate(sample)}</bdi></dd></div><div><dt>{t("regional.number", "Number")}</dt><dd><bdi>{preview.formatNumber(1234567.89)}</bdi></dd></div></dl></section>
        <p className="regional-scope">{t("regional.scope", "Language applies to navigation and shared controls. Specialized editors and record content retain their original language. Regional formats apply to workflow history and supported date and number displays.")}</p>
        <footer><button type="button" className="ghost-button" onClick={onClose}>{t("common.cancel", "Cancel")}</button><button type="submit" className="primary-button">{t("common.savePreferences", "Save preferences")}</button></footer>
      </form>
    </div>
  </div>, document.body);
}

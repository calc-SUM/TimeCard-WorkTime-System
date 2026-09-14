import type { EditTarget, EditableSettingKey } from "./componentTypes";
import type { WorkTimeSettings } from "../domain/types";

interface Props { settings: WorkTimeSettings; errors: Partial<Record<EditableSettingKey, readonly string[]>>; activeTarget: EditTarget | null; draft: string; onEdit: (target: EditTarget) => void; onTogglePenalty: () => void; onToggleNoPayDay: () => void; onToggleNoPayNight: () => void }
const rows: { label: string; start: EditableSettingKey; end: EditableSettingKey }[] = [
  { label: "昼定時", start: "dayStart", end: "dayEnd" }, { label: "NoPay(昼)", start: "noPayDayStart", end: "noPayDayEnd" },
  { label: "夜定時", start: "nightStart", end: "nightEnd" }, { label: "NoPay(夜)", start: "noPayNightStart", end: "noPayNightEnd" },
];

function SettingButton({ field, ...props }: { field: EditableSettingKey; settings: WorkTimeSettings; errors: Props["errors"]; activeTarget: EditTarget | null; draft: string; onEdit: Props["onEdit"] }) {
  const active = props.activeTarget?.kind === "setting" && props.activeTarget.key === field;
  return <button type="button" data-editable aria-label={`設定 ${field}`} className={`editable-cell ${props.errors[field]?.length ? "cell-error" : ""} ${active ? "is-editing" : ""}`} onClick={() => props.onEdit({ kind: "setting", key: field })}>{active ? props.draft : String(props.settings[field])}</button>;
}

function OffDiagonal() {
  return <svg className="setting-off-diagonal" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" /></svg>;
}

export function CalculationSettings(props: Props) {
  const penaltyActive = props.activeTarget?.kind === "setting" && props.activeTarget.key === "penaltyMinutes";
  return <section className="settings-section"><h2>各種設定</h2><table className="settings-table"><thead><tr><th className="diagonal-cell" aria-label="項目"><svg className="diagonal-line" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="0" x2="100" y2="100" /></svg></th><th>始</th><th>終</th></tr></thead><tbody>
    {rows.map((row) => {
      const isDayNoPay = row.start === "noPayDayStart";
      const isNightNoPay = row.start === "noPayNightStart";
      const enabled = isDayNoPay ? props.settings.noPayDayEnabled : isNightNoPay ? props.settings.noPayNightEnabled : true;
      const toggle = isDayNoPay ? props.onToggleNoPayDay : props.onToggleNoPayNight;
      return <tr key={row.label}><th className={isDayNoPay || isNightNoPay ? "setting-toggle-label-cell" : undefined}>{isDayNoPay || isNightNoPay ? <div className="penalty-label-content"><span className="penalty-label-text">{row.label}</span><button className={`toggle setting-inline-toggle ${enabled ? "is-on" : ""}`} type="button" role="switch" aria-checked={enabled} aria-label={`${row.label}有効`} onClick={toggle}><span /></button></div> : row.label}</th><td className={!enabled ? "setting-off-value" : undefined}><SettingButton field={row.start} {...props} />{!enabled && <OffDiagonal />}</td><td className={!enabled ? "setting-off-value" : undefined}><SettingButton field={row.end} {...props} />{!enabled && <OffDiagonal />}</td></tr>;
    })}
    <tr className="penalty-row"><td className="penalty-label-cell"><div className="penalty-label-content"><span className="penalty-label-text">遅刻罰則</span><button className={`toggle penalty-toggle ${props.settings.penaltyEnabled ? "is-on" : ""}`} type="button" role="switch" aria-checked={props.settings.penaltyEnabled} aria-label="ペナルティ有効" onClick={props.onTogglePenalty}><span /></button></div></td><td className={`penalty-value-cell ${props.settings.penaltyEnabled ? "" : "setting-off-value"}`} colSpan={2}><button type="button" data-editable aria-label="設定 penaltyMinutes" className={`editable-cell ${props.errors.penaltyMinutes?.length ? "cell-error" : ""} ${penaltyActive ? "is-editing" : ""}`} onClick={() => props.onEdit({ kind: "setting", key: "penaltyMinutes" })}>{penaltyActive ? props.draft : `${props.settings.penaltyMinutes}分`}</button>{!props.settings.penaltyEnabled && <OffDiagonal />}</td></tr>
  </tbody></table></section>;
}

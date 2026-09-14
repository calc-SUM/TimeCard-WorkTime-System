import { useLayoutEffect, useRef, useState } from "react";
import type { EditTarget } from "./componentTypes";
import { calculateRow } from "../domain/calculation";
import { formatDuration, validateRow } from "../domain/validation";
import type { WorkTimeSettings } from "../domain/types";
import type { CardUiState, TimeCellUiState } from "../fixtures/developmentFixture";
import { isWorkRowVisible } from "../ui/workRows";

export type RowOperation = "insert-above" | "insert-below" | "delete";
interface Props { card: CardUiState; displayName: string; settings: WorkTimeSettings; totalMinutes: number; calculationSettingsValid: boolean; activeTarget: EditTarget | null; draft: string; rowMenuOpen: boolean; onEdit: (target: EditTarget) => void; onToggleRowMenu: () => void; onRowOperation: (operation: RowOperation) => void }

const valuesOf = (cells: CardUiState["rows"][number]["cells"]) => cells.map((cell) => cell.value) as [string | null, string | null, string | null, string | null];
const formatRowDuration = (totalMinutes: number) => `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m`;
function colorState(cell: TimeCellUiState, cells: CardUiState["rows"][number]["cells"], index: number) {
  if (validateRow(valuesOf(cells)).cellErrors[index].length > 0) return "error";
  if (cell.userModified) return "modified";
  if (cell.recognitionIssue) return "review";
  if (cell.reviewRequired && !cell.reviewAcknowledged) return "review";
  return "normal";
}

export function TimeCardTable({ card, displayName, settings, totalMinutes, calculationSettingsValid, activeTarget, draft, rowMenuOpen, onEdit, onToggleRowMenu, onRowOperation }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const [actionTop, setActionTop] = useState<number | null>(null);
  const exceptionActive = activeTarget?.kind === "exception" && activeTarget.cardId === card.id;
  const visibleRows = card.rows
    .filter(isWorkRowVisible);
  const selectedRowId = activeTarget?.kind === "cell" && activeTarget.cardId === card.id ? activeTarget.rowId : null;
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || !selectedRowId) { setActionTop(null); return; }
    const row = [...section.querySelectorAll<HTMLElement>("[data-row-id]")].find((candidate) => candidate.dataset.rowId === selectedRowId);
    if (!row) { setActionTop(null); return; }
    const update = () => {
      const sectionRect = section.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      setActionTop(rowRect.top - sectionRect.top + rowRect.height / 2);
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(row);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  });
  const deleteDisabled = visibleRows.length <= 1;
  return <section ref={sectionRef} className="card-section" aria-label={displayName}>
    <h2>{displayName}</h2>
    <table className="timecard-table"><thead><tr>{["1欄", "2欄", "3欄", "4欄", "合計"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{visibleRows.map((row) => {
        const validation = validateRow(valuesOf(row.cells));
        const rowTotal = calculationSettingsValid ? calculateRow(valuesOf(row.cells), settings) : null;
        const totalText = validation.state === "blank" ? "" : rowTotal === null ? "エラー" : formatRowDuration(rowTotal);
        return <tr key={row.rowId} data-row-id={row.rowId} data-source-row={row.sourceRowIndex}>{row.cells.map((cell, cellIndex) => {
          const active = activeTarget?.kind === "cell" && activeTarget.cardId === card.id && activeTarget.rowId === row.rowId && activeTarget.cellIndex === cellIndex;
          const color = colorState(cell, row.cells, cellIndex);
          return <td key={cellIndex} className={`time-cell cell-${color}`} data-recognition-issue={cell.recognitionIssue}><button type="button" data-editable aria-label={`${displayName} ${["A欄", "B欄", "C欄", "D欄"][cellIndex]}`} className={`editable-cell ${active ? "is-editing" : ""}`} onClick={() => onEdit({ kind: "cell", cardId: card.id, rowId: row.rowId, cellIndex })}>{active ? draft : (cell.value ?? "")}</button></td>;
        })}<td className={`row-total ${validation.state !== "blank" && rowTotal === null ? "error-text" : ""}`}>{totalText}</td></tr>;
      })}</tbody>
    </table>
    {selectedRowId && actionTop !== null && <div className="row-action-anchor" style={{ top: actionTop }} data-row-action>
      <button type="button" className="row-action-button" aria-label="行操作" aria-expanded={rowMenuOpen} onClick={(event) => { event.stopPropagation(); onToggleRowMenu(); }}>︙</button>
      {rowMenuOpen && <div className="row-action-menu" role="menu">
        <button type="button" role="menuitem" onClick={() => onRowOperation("insert-above")}>上に行を追加</button>
        <button type="button" role="menuitem" onClick={() => onRowOperation("insert-below")}>下に行を追加</button>
        <button type="button" role="menuitem" disabled={deleteDisabled} onClick={() => onRowOperation("delete")}>行を削除</button>
      </div>}
    </div>}
    <table className="card-total-table"><tbody>
      <tr><th>例外</th><td><button type="button" data-editable aria-label={`${displayName} 例外`} className={`editable-cell ${card.exceptionInvalidInput !== null ? "cell-error" : ""} ${exceptionActive ? "is-editing" : ""}`} onClick={() => onEdit({ kind: "exception", cardId: card.id })}>{exceptionActive ? draft : (card.exceptionInvalidInput ?? formatDuration(card.exceptionMinutes ?? 0))}</button></td></tr>
      <tr className="card-grand-total"><th>総計</th><td className={calculationSettingsValid ? "" : "error-text"}>{calculationSettingsValid ? formatDuration(totalMinutes) : "エラー"}</td></tr>
    </tbody></table>
  </section>;
}

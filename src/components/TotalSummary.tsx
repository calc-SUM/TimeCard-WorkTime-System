import { formatDuration } from "../domain/validation";
import type { CardUiState } from "../fixtures/developmentFixture";

export function TotalSummary({ cards, displayNames, totals, calculationSettingsValid }: { cards: CardUiState[]; displayNames: Readonly<Record<string, string>>; totals: ReadonlyMap<string, number>; calculationSettingsValid: boolean }) {
  return <section className="summary-section"><h2>総計一覧</h2><table className="summary-table"><thead><tr><th>ファイル名</th><th>総計</th></tr></thead><tbody>{cards.map((card) => <tr key={card.id}><td>{displayNames[card.photoId] ?? card.fileName}</td><td className={calculationSettingsValid ? "" : "error-text"}>{calculationSettingsValid ? formatDuration(totals.get(card.id) ?? 0) : "エラー"}</td></tr>)}</tbody></table></section>;
}

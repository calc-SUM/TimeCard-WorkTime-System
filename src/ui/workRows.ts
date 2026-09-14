import type { TimeCellUiState, WorkRowUiState } from "../fixtures/developmentFixture";

export function isWorkRowVisible(row: WorkRowUiState): boolean {
  return row.manuallyInserted || row.cells.some((cell) => cell.value !== null && cell.value !== "" || cell.recognitionIssue !== undefined);
}

const emptyCell = (): TimeCellUiState => ({
  value: "",
  originalRecognizedValue: "",
  reviewRequired: false,
  reviewAcknowledged: false,
  userModified: false,
});

export function createManualWorkRow(rowId: string): WorkRowUiState {
  return {
    rowId,
    sourceRowIndex: -1,
    manuallyInserted: true,
    cells: [emptyCell(), emptyCell(), emptyCell(), emptyCell()],
  };
}

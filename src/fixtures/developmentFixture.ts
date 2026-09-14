import type { RowCells } from "../domain/types";

export interface TimeCellUiState { value: string | null; originalRecognizedValue: string | null; reviewRequired: boolean; reviewAcknowledged: boolean; userModified: boolean; recognitionIssue?: "suspicious_content" | "recognition_failed"; recognitionReviewReasons?: { recognizer: boolean; routeDisagreement: boolean; cropFailure: boolean } }
export interface WorkRowUiState { rowId: string; sourceRowIndex: number; manuallyInserted: boolean; cells: [TimeCellUiState, TimeCellUiState, TimeCellUiState, TimeCellUiState] }
export interface CardUiState {
  id: string;
  photoId: string;
  fileName: string;
  rows: WorkRowUiState[];
  exceptionMinutes: number | null;
  exceptionInvalidInput: string | null;
}
export interface PhotoUiState { id: string; fileName: string; status: "未処理" | "処理中" | "完了" | "エラー" }

const cell = (value: string | null, reviewRequired = false): TimeCellUiState => ({ value, originalRecognizedValue: value, reviewRequired, reviewAcknowledged: false, userModified: false });
const row = (sourceRowIndex: number, values: RowCells, reviewCell = -1): WorkRowUiState => ({ rowId: `recognized-${sourceRowIndex}`, sourceRowIndex, manuallyInserted: false, cells: values.map((value, index) => cell(value, index === reviewCell)) as WorkRowUiState["cells"] });

export function createDevelopmentFixture(): { cards: CardUiState[]; photos: PhotoUiState[] } {
  return {
    photos: [
      { id: "fixture-photo-1", fileName: "UI確認用タイムカード.jpg", status: "完了" },
      { id: "fixture-photo-2", fileName: "UI確認用タイムカード2.jpg", status: "未処理" },
    ],
    cards: [
      { id: "fixture-card-1", photoId: "fixture-photo-1", fileName: "UI確認用タイムカード.jpg", rows: [row(0, ["10:57", "14:06", "16:43", "21:07"], 0)], exceptionMinutes: 0, exceptionInvalidInput: null },
      { id: "fixture-card-2", photoId: "fixture-photo-2", fileName: "UI確認用タイムカード2.jpg", rows: [row(0, ["11:00", "14:00", "16:45", "21:00"])], exceptionMinutes: 0, exceptionInvalidInput: null },
    ],
  };
}

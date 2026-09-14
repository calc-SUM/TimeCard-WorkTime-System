import type { CardUiState, PhotoUiState, TimeCellUiState, WorkRowUiState } from "./developmentFixture";
import { commitTimeInput } from "../domain/validation";

type InputRow = readonly [string | null, string | null, string | null, string | null];

const card1Rows: readonly InputRow[] = [
  ["10:59", "11:30", null, null],
  ["11:00", "11:30", null, null],
  ["11:01", "11:30", null, null],
  ["13:59", "14:10", null, null],
  ["14:00", "14:10", null, null],
  ["14:01", "17:00", null, null],
  ["16:44", "17:00", null, null],
  ["16:45", "17:00", null, null],
  ["16:46", "17:00", null, null],
  ["20:59", "21:10", null, null],
  ["21:00", "21:10", null, null],
  ["21:01", "21:10", null, null],
  ["21:05", "21:10", null, null],
  ["21:06", "22:00", null, null],
  ["10:00", "10:30", null, null],
  ["14:01", "14:30", null, null],
  ["11:00", "13:59", null, null],
  ["11:00", "14:00", null, null],
  ["11:00", "14:01", null, null],
  ["11:00", "14:02", null, null],
  ["11:00", "14:04", null, null],
  ["11:00", "14:05", null, null],
  ["11:00", "14:06", null, null],
  ["16:45", "20:59", null, null],
  ["16:45", "21:00", null, null],
  ["16:45", "21:01", null, null],
  ["16:45", "21:02", null, null],
  ["16:45", "21:04", null, null],
  ["16:45", "21:05", null, null],
  ["16:45", "21:06", null, null],
  ["11:00", "21:10", null, null],
];

const card2Rows: readonly InputRow[] = [
  ["10:00", "22:00", null, null],
  ["11:01", "21:10", null, null],
  ["10:57", "14:06", "16:43", "21:07"],
  ["10:00", "14:00", "16:45", "21:00"],
  ["11:01", "14:05", "16:46", "21:05"],
  ["14:01", "16:44", "16:45", "21:06"],
  ["10:00", "10:30", "14:01", "14:30"],
  ["11:00", "12:00", "12:30", "13:30"],
  ["16:45", "17:45", "18:00", "19:00"],
  ["13:55", "14:06", "20:59", "21:10"],
  ["10:59", "11:30", "16:46", "17:00"],
  ["11:00", "14:06", "21:05", "23:59"],
  ["00:00", "00:01", null, null],
  ["00:00", "10:59", null, null],
  ["00:00", "23:59", null, null],
  ["14:01", "16:44", null, null],
  ["14:01", "16:45", null, null],
  ["14:01", "16:46", null, null],
  ["21:01", "23:59", null, null],
  ["23:58", "23:59", null, null],
  ["11:00", "12:00", "13:00", "14:00"],
  ["11:00", "14:00", "16:45", "23:59"],
  ["10:59", "14:01", "16:44", "21:06"],
  ["11:01", "13:59", "16:46", "20:59"],
  ["13:59", "14:01", "20:59", "21:01"],
  ["11:00", "14:05", "16:45", "21:05"],
  ["11:00", "14:06", "16:45", "21:06"],
  ["00:00", "12:00", "13:00", "23:59"],
  ["11:00", "11:01", "16:45", "16:46"],
  ["13:59", "14:00", "20:59", "21:00"],
  ["14:00", "14:01", "21:00", "21:01"],
];

const card3Rows: readonly InputRow[] = [
  ["11:00", null, null, null],
  ["11:00", "14:00", "16:45", null],
  ["11:00", "11:00", null, null],
  ["12:00", "11:00", null, null],
  ["11:00", "14:00", "13:00", "21:00"],
  ["11:00", "14:00", "14:00", "21:00"],
  ["11:00", "14:00", "16:45", "16:44"],
  ["23:00", "01:00", null, null],
  ["21:00", "21:00", "21:00", "21:00"],
  ["11:00", null, null, "12:00"],
  [null, "11:00", "12:00", null],
  [null, null, "16:45", "21:00"],
  ["11:00", "14:00", null, null],
  [null, "11:00", null, "14:00"],
  ["00:00", "23:59", null, null],
  ["00:01", "23:58", null, null],
  ["14:00", "16:45", null, null],
  ["14:00", "21:00", null, null],
  ["16:45", "23:59", null, null],
  ["21:00", "23:59", null, null],
  [raw("2400"), null, null, null],
  [raw("2460"), null, null, null],
  [raw("1260"), null, null, null],
  [raw("9999"), null, null, null],
  [raw("123"), null, null, null],
  [raw("12345"), null, null, null],
  [raw("12A0"), null, null, null],
  [raw("-100"), null, null, null],
  [raw("2359"), raw("2400"), null, null],
  [raw("0000"), raw("2359"), null, null],
  [raw("0000"), raw("0001"), null, null],
];

function raw(input: string): string {
  const committed = commitTimeInput(input);
  return committed.valid ? committed.value : input;
}

function cell(value: string | null): TimeCellUiState {
  return {
    value,
    originalRecognizedValue: value,
    reviewRequired: false,
    reviewAcknowledged: false,
    userModified: false,
  };
}

function rows(values: readonly InputRow[]): WorkRowUiState[] {
  return values.map((input, sourceRowIndex) => ({
    rowId: `recognized-${sourceRowIndex}`,
    sourceRowIndex,
    manuallyInserted: false,
    cells: input.map(cell) as WorkRowUiState["cells"],
  }));
}

function card(index: number, inputRows: readonly InputRow[]): CardUiState {
  const fileName = `計算検証_${index}.jpg`;
  return {
    id: `calculation-fixture-card-${index}`,
    photoId: `calculation-fixture-photo-${index}`,
    fileName,
    rows: rows(inputRows),
    exceptionMinutes: 0,
    exceptionInvalidInput: null,
  };
}

export function createBlindCalculationFixture(): { cards: CardUiState[]; photos: PhotoUiState[] } {
  return {
    photos: [1, 2, 3].map((index) => ({
      id: `calculation-fixture-photo-${index}`,
      fileName: `計算検証_${index}.jpg`,
      status: "完了" as const,
    })),
    cards: [card(1, card1Rows), card(2, card2Rows), card(3, card3Rows)],
  };
}

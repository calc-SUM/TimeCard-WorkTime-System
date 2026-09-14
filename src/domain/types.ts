export type TimeCellValue = string | null;

export type RowCells = readonly [
  TimeCellValue,
  TimeCellValue,
  TimeCellValue,
  TimeCellValue,
];

export interface WorkTimeSettings {
  dayStart: string;
  dayEnd: string;
  noPayDayStart: string;
  noPayDayEnd: string;
  noPayDayEnabled: boolean;
  nightStart: string;
  nightEnd: string;
  noPayNightStart: string;
  noPayNightEnd: string;
  noPayNightEnabled: boolean;
  penaltyMinutes: number;
  penaltyEnabled: boolean;
}

export const DEFAULT_SETTINGS: Readonly<WorkTimeSettings> = {
  dayStart: "11:00",
  dayEnd: "14:00",
  noPayDayStart: "14:00",
  noPayDayEnd: "14:05",
  noPayDayEnabled: true,
  nightStart: "16:45",
  nightEnd: "21:00",
  noPayNightStart: "21:00",
  noPayNightEnd: "21:05",
  noPayNightEnabled: true,
  penaltyMinutes: 5,
  penaltyEnabled: true,
};

export type RowValidationState = "blank" | "valid" | "invalid";

export interface RowValidationResult {
  state: RowValidationState;
  valid: boolean;
  nonEmptyCount: number;
  cellErrors: readonly (readonly string[])[];
  rowErrors: readonly string[];
}

export type CommitResult<T> =
  | { valid: true; value: T; errors: readonly [] }
  | { valid: false; value: null; errors: readonly string[] };

export interface SettingsValidationResult {
  valid: boolean;
  fieldErrors: Readonly<Partial<Record<keyof WorkTimeSettings, readonly string[]>>>;
}

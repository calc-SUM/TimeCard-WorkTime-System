import type {
  CommitResult,
  RowCells,
  RowValidationResult,
  SettingsValidationResult,
  WorkTimeSettings,
} from "./types";

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const FOUR_DIGIT_PATTERN = /^\d{4}$/;

export function parseClockTime(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function commitTimeInput(input: string): CommitResult<string> {
  if (!FOUR_DIGIT_PATTERN.test(input)) {
    return { valid: false, value: null, errors: ["時刻は4桁で入力してください"] };
  }

  const hours = Number(input.slice(0, 2));
  const minutes = Number(input.slice(2, 4));
  if (hours > 23 || minutes > 59) {
    return { valid: false, value: null, errors: ["時刻は00:00から23:59の範囲で入力してください"] };
  }

  return {
    valid: true,
    value: `${input.slice(0, 2)}:${input.slice(2, 4)}`,
    errors: [],
  };
}

export function commitExceptionInput(input: string): CommitResult<number> {
  if (!FOUR_DIGIT_PATTERN.test(input)) {
    return { valid: false, value: null, errors: ["例外時間は4桁で入力してください"] };
  }

  const hours = Number(input.slice(0, 2));
  const minutes = Number(input.slice(2, 4));
  if (hours > 99 || minutes > 59) {
    return { valid: false, value: null, errors: ["例外時間の分は00から59の範囲で入力してください"] };
  }

  return { valid: true, value: hours * 60 + minutes, errors: [] };
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}

export function validateRow(cells: RowCells): RowValidationResult {
  const cellErrors: string[][] = cells.map(() => []);
  const rowErrors: string[] = [];
  const populated = cells
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: string; index: number } => item.value !== null && item.value !== "");

  if (populated.length === 0) {
    return { state: "blank", valid: true, nonEmptyCount: 0, cellErrors, rowErrors };
  }

  const parsed = populated.map(({ value, index }) => {
    const minutes = parseClockTime(value);
    if (minutes === null) cellErrors[index].push("時刻形式が不正です");
    return { index, minutes };
  });

  const occupied = cells.map((value) => value !== null && value !== "");
  const abOnly = occupied[0] && occupied[1] && !occupied[2] && !occupied[3];
  const cdOnly = !occupied[0] && !occupied[1] && occupied[2] && occupied[3];
  const abcd = occupied.every(Boolean);
  const validPattern = abOnly || cdOnly || abcd;

  if (!validPattern) {
    const message = "打刻はA-BまたはC-Dの固定ペアで入力してください";
    rowErrors.push(message);
    for (const { index } of populated) cellErrors[index].push(message);
  }

  if (validPattern && parsed.every(({ minutes }) => minutes !== null)) {
    const ordered = abcd ? [0, 1, 2, 3] : abOnly ? [0, 1] : [2, 3];
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = parseClockTime(cells[ordered[index - 1]]!);
      const current = parseClockTime(cells[ordered[index]]!);
      if (current! <= previous!) {
        const message = current === previous ? "時刻が重複しています" : "時刻が昇順ではありません";
        rowErrors.push(message);
        for (const item of populated) cellErrors[item.index].push(message);
        break;
      }
    }
  }

  const valid = cellErrors.every((errors) => errors.length === 0);
  return {
    state: valid ? "valid" : "invalid",
    valid,
    nonEmptyCount: populated.length,
    cellErrors,
    rowErrors,
  };
}

export function validateSettings(settings: WorkTimeSettings): SettingsValidationResult {
  const fieldErrors: Partial<Record<keyof WorkTimeSettings, string[]>> = {};
  const timeKeys = [
    "dayStart",
    "dayEnd",
    "noPayDayStart",
    "noPayDayEnd",
    "nightStart",
    "nightEnd",
    "noPayNightStart",
    "noPayNightEnd",
  ] as const;

  const parsed = {} as Record<(typeof timeKeys)[number], number>;
  for (const key of timeKeys) {
    const value = parseClockTime(settings[key]);
    if (value === null) fieldErrors[key] = ["時刻形式が不正です"];
    else parsed[key] = value;
  }

  const addMeaningError = (keys: readonly (keyof WorkTimeSettings)[], message: string) => {
    for (const key of keys) fieldErrors[key] = [...(fieldErrors[key] ?? []), message];
  };

  if (
    parsed.dayStart !== undefined &&
    parsed.dayEnd !== undefined &&
    parsed.nightStart !== undefined &&
    parsed.nightEnd !== undefined &&
    !(parsed.dayStart <= parsed.dayEnd && parsed.dayEnd <= parsed.nightStart && parsed.nightStart <= parsed.nightEnd)
  ) {
    addMeaningError(["dayStart", "dayEnd", "nightStart", "nightEnd"], "始業区間の順序が不正です");
  }

  if (parsed.noPayDayStart !== undefined && parsed.noPayDayEnd !== undefined && parsed.noPayDayStart > parsed.noPayDayEnd) {
    addMeaningError(["noPayDayStart", "noPayDayEnd"], "NoPay(昼)の順序が不正です");
  }
  if (parsed.noPayNightStart !== undefined && parsed.noPayNightEnd !== undefined && parsed.noPayNightStart > parsed.noPayNightEnd) {
    addMeaningError(["noPayNightStart", "noPayNightEnd"], "NoPay(夜)の順序が不正です");
  }
  if (!Number.isInteger(settings.penaltyMinutes) || settings.penaltyMinutes < 0) {
    fieldErrors.penaltyMinutes = ["遅刻ペナルティは0以上の整数である必要があります"];
  }

  return { valid: Object.keys(fieldErrors).length === 0, fieldErrors };
}

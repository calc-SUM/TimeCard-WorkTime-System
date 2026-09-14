import { DEFAULT_SETTINGS, type RowCells, type WorkTimeSettings } from "./types";
import { parseClockTime, validateRow, validateSettings } from "./validation";

interface ParsedSettings {
  dayStart: number;
  dayEnd: number;
  noPayDayStart: number;
  noPayDayEnd: number;
  noPayDayEnabled: boolean;
  nightStart: number;
  nightEnd: number;
  noPayNightStart: number;
  noPayNightEnd: number;
  noPayNightEnabled: boolean;
  penaltyMinutes: number;
  penaltyEnabled: boolean;
}

function requiredClock(value: string): number {
  const parsed = parseClockTime(value);
  if (parsed === null) throw new Error(`Invalid clock setting: ${value}`);
  return parsed;
}

function parseSettings(settings: WorkTimeSettings): ParsedSettings {
  if (!validateSettings(settings).valid) throw new Error("Invalid work-time settings");
  return {
    dayStart: requiredClock(settings.dayStart),
    dayEnd: requiredClock(settings.dayEnd),
    noPayDayStart: requiredClock(settings.noPayDayStart),
    noPayDayEnd: requiredClock(settings.noPayDayEnd),
    noPayDayEnabled: settings.noPayDayEnabled,
    nightStart: requiredClock(settings.nightStart),
    nightEnd: requiredClock(settings.nightEnd),
    noPayNightStart: requiredClock(settings.noPayNightStart),
    noPayNightEnd: requiredClock(settings.noPayNightEnd),
    noPayNightEnabled: settings.noPayNightEnabled,
    penaltyMinutes: settings.penaltyMinutes,
    penaltyEnabled: settings.penaltyEnabled,
  };
}

export function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function calculateInterval(
  originalStart: number,
  end: number,
  settings: WorkTimeSettings = DEFAULT_SETTINGS,
): number {
  const s = parseSettings(settings);
  let correctedStart: number;

  if (originalStart < s.dayStart) correctedStart = s.dayStart;
  else if (originalStart <= s.dayEnd) correctedStart = originalStart;
  else if (originalStart <= s.nightStart) correctedStart = s.nightStart;
  else correctedStart = originalStart;

  const dayLate = originalStart > s.dayStart && originalStart <= s.dayEnd;
  const nightLate = originalStart > s.nightStart && originalStart <= s.nightEnd;
  const penalty = s.penaltyEnabled && (dayLate || nightLate) ? s.penaltyMinutes : 0;
  const noPay =
    (s.noPayDayEnabled ? overlapMinutes(correctedStart, end, s.noPayDayStart, s.noPayDayEnd) : 0) +
    (s.noPayNightEnabled ? overlapMinutes(correctedStart, end, s.noPayNightStart, s.noPayNightEnd) : 0);

  return Math.max(0, end - correctedStart - noPay - penalty);
}

export function calculateRow(cells: RowCells, settings: WorkTimeSettings = DEFAULT_SETTINGS): number | null {
  const validation = validateRow(cells);
  if (validation.state !== "valid") return null;

  let total = 0;
  if (cells[0] && cells[1]) total += calculateInterval(requiredClock(cells[0]), requiredClock(cells[1]), settings);
  if (cells[2] && cells[3]) total += calculateInterval(requiredClock(cells[2]), requiredClock(cells[3]), settings);
  return total;
}

export function calculateCardTotal(
  rows: readonly RowCells[],
  exceptionMinutes: number,
  settings: WorkTimeSettings = DEFAULT_SETTINGS,
): number {
  return rows.reduce((total, row) => total + (calculateRow(row, settings) ?? 0), exceptionMinutes);
}

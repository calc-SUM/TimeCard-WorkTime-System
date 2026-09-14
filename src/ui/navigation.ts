import type { EditTarget, EditableSettingKey } from "../components/componentTypes";
import type { CardUiState } from "../fixtures/developmentFixture";
import type { KeypadDirection } from "../components/CustomKeypad";
import { isWorkRowVisible } from "./workRows";

export type PenaltyOccurrence = "first" | "final" | null;

const settingHorizontal: EditableSettingKey[] = [
  "dayStart", "dayEnd", "noPayDayStart", "noPayDayEnd",
  "nightStart", "nightEnd", "noPayNightStart", "noPayNightEnd", "penaltyMinutes",
];
const settingVertical: EditableSettingKey[] = [
  "dayStart", "noPayDayStart", "nightStart", "noPayNightStart", "penaltyMinutes",
  "dayEnd", "noPayDayEnd", "nightEnd", "noPayNightEnd", "penaltyMinutes",
];

function visibleRows(card: CardUiState): CardUiState["rows"] {
  return card.rows
    .filter(isWorkRowVisible);
}

export function buildWorkNavigation(cards: readonly CardUiState[]): { vertical: EditTarget[]; horizontal: EditTarget[] } {
  const vertical: EditTarget[] = [];
  const horizontal: EditTarget[] = [];
  for (const card of cards) {
    const rows = visibleRows(card);
    for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) {
      for (const row of rows) vertical.push({ kind: "cell", cardId: card.id, rowId: row.rowId, cellIndex });
    }
    for (const row of rows) {
      for (let cellIndex = 0; cellIndex < 4; cellIndex += 1) horizontal.push({ kind: "cell", cardId: card.id, rowId: row.rowId, cellIndex });
    }
    const exception: EditTarget = { kind: "exception", cardId: card.id };
    vertical.push(exception);
    horizontal.push(exception);
  }
  return { vertical, horizontal };
}

function clampedNeighbor(order: readonly EditTarget[], current: EditTarget, delta: number): EditTarget {
  const index = order.findIndex((target) => navigationTargetId(target) === navigationTargetId(current));
  if (index < 0 || order.length === 0) return current;
  return order[Math.max(0, Math.min(order.length - 1, index + delta))];
}

export function nextWorkTarget(cards: readonly CardUiState[], current: EditTarget, direction: KeypadDirection): EditTarget {
  const orders = buildWorkNavigation(cards);
  const order = direction === "up" || direction === "down" ? orders.vertical : orders.horizontal;
  return clampedNeighbor(order, current, direction === "up" || direction === "left" ? -1 : 1);
}

export function nextSettingTarget(
  current: Extract<EditTarget, { kind: "setting" }>,
  direction: KeypadDirection,
  penaltyOccurrence: PenaltyOccurrence,
): { target: Extract<EditTarget, { kind: "setting" }>; penaltyOccurrence: PenaltyOccurrence } {
  if (direction === "left" || direction === "right") {
    const target = clampedSetting(settingHorizontal, current.key, direction === "left" ? -1 : 1);
    return { target: { kind: "setting", key: target }, penaltyOccurrence: target === "penaltyMinutes" ? "final" : null };
  }

  const currentIndex = current.key === "penaltyMinutes"
    ? (penaltyOccurrence === "first" ? 4 : 9)
    : settingVertical.indexOf(current.key);
  const nextIndex = Math.max(0, Math.min(settingVertical.length - 1, currentIndex + (direction === "up" ? -1 : 1)));
  const target = settingVertical[nextIndex];
  return {
    target: { kind: "setting", key: target },
    penaltyOccurrence: target === "penaltyMinutes" ? (nextIndex === 4 ? "first" : "final") : null,
  };
}

function clampedSetting(order: readonly EditableSettingKey[], current: EditableSettingKey, delta: number): EditableSettingKey {
  const index = order.indexOf(current);
  if (index < 0) return current;
  return order[Math.max(0, Math.min(order.length - 1, index + delta))];
}

export function navigationTargetId(target: EditTarget): string {
  if (target.kind === "cell") return `cell:${target.cardId}:${target.rowId}:${target.cellIndex}`;
  if (target.kind === "exception") return `exception:${target.cardId}`;
  return `setting:${target.key}`;
}

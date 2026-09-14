import type { WorkTimeSettings } from "../domain/types";

export type EditableSettingKey = Exclude<keyof WorkTimeSettings, "penaltyEnabled" | "noPayDayEnabled" | "noPayNightEnabled">;
export type EditTarget =
  | { kind: "cell"; cardId: string; rowId: string; cellIndex: number }
  | { kind: "exception"; cardId: string }
  | { kind: "setting"; key: EditableSettingKey };

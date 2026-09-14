export type KeypadDirection = "up" | "left" | "right" | "down";

interface Props { value: string; onDigit: (digit: string) => void; onDelete: () => void; onClearAll: () => void; onMove: (direction: KeypadDirection) => void }

export function CustomKeypad({ value, onDigit, onDelete, onClearAll, onMove }: Props) {
  return (
    <section className="keypad" data-keypad aria-label="カスタムテンキー">
      <output className="keypad-value" aria-label="編集中の値">{value || "\u00a0"}</output>
      <div className="keypad-layout">
        <div className="number-keys">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button key={digit} type="button" onClick={() => onDigit(digit)}>{digit}</button>)}
          <button className="zero-key" type="button" onClick={() => onDigit("0")}>0</button>
        </div>
        <div className="function-keys">
          <button className="clear-all-key" type="button" onClick={onClearAll}>全削</button>
          <button className="delete-key" type="button" aria-label="削除キー" onClick={onDelete}>
            <svg aria-hidden="true" viewBox="0 0 32 24"><path d="M12 3h16v18H12L3 12l9-9Z"/><path d="m16 8 7 8m0-8-7 8"/></svg>
          </button>
          <button className="up-key" type="button" aria-label="上" onClick={() => onMove("up")}>↑</button>
          <button className="left-key" type="button" aria-label="左" onClick={() => onMove("left")}>←</button>
          <button className="right-key" type="button" aria-label="右" onClick={() => onMove("right")}>→</button>
          <button className="down-key" type="button" aria-label="下" onClick={() => onMove("down")}>↓</button>
        </div>
      </div>
    </section>
  );
}

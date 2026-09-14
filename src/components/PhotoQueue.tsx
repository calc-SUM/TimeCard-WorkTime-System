import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import type { PhotoUiState } from "../fixtures/developmentFixture";

interface Props {
  photos: PhotoUiState[];
  displayNames: Readonly<Record<string, string>>;
  selectedIds: Set<string>;
  onSelectionChange: Dispatch<SetStateAction<Set<string>>>;
  onDisplayNameChange: (photoId: string, displayName: string) => void;
  onDelete: () => void;
  onCalculate: () => void;
  processing: boolean;
}

export function PhotoQueue({ photos, displayNames, selectedIds, onSelectionChange, onDisplayNameChange, onDelete, onCalculate, processing }: Props) {
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editingPhotoId) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingPhotoId]);
  const toggle = (id: string) => onSelectionChange((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const startEditing = (photo: PhotoUiState) => {
    setEditingPhotoId(photo.id);
    setDraft(displayNames[photo.id] ?? photo.fileName);
  };
  const finishEditing = () => {
    if (!editingPhotoId) return;
    const trimmed = draft.trim();
    if (trimmed) onDisplayNameChange(editingPhotoId, trimmed);
    setEditingPhotoId(null);
  };
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") setEditingPhotoId(null);
  };
  return (
    <div className="photo-queue">
      <h2>アップロード済みファイル</h2>
      <div className="photo-list">{photos.map((photo) => {
        const displayName = displayNames[photo.id] ?? photo.fileName;
        return <div className="photo-row" key={photo.id}>
          {editingPhotoId === photo.id
            ? <input ref={nameInputRef} className="photo-name-input" type="text" inputMode="text" enterKeyHint="done" aria-label={`${displayName}の表示名`} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} onBlur={finishEditing} onKeyDown={handleNameKeyDown} />
            : <button className="photo-name photo-name-button" type="button" onClick={() => startEditing(photo)}>{displayName}</button>}
          <span className="status-badge">{photo.status}</span>
          <input aria-label={`${displayName}を削除対象にする`} type="checkbox" checked={selectedIds.has(photo.id)} onChange={() => toggle(photo.id)} />
        </div>;
      })}</div>
      <div className="queue-actions"><button className="primary-button calculate-button" type="button" onClick={onCalculate} disabled={processing}>計算を開始</button><button className="delete-button" type="button" onClick={onDelete} disabled={processing}>削除</button></div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CalculationSettings } from "./components/CalculationSettings";
import { CustomKeypad, type KeypadDirection } from "./components/CustomKeypad";
import { PhotoQueue } from "./components/PhotoQueue";
import { TimeCardTable, type RowOperation } from "./components/TimeCardTable";
import { TotalSummary } from "./components/TotalSummary";
import type { EditTarget, EditableSettingKey } from "./components/componentTypes";
import { calculateCardTotal } from "./domain/calculation";
import { commitExceptionInput, commitTimeInput, validateSettings } from "./domain/validation";
import { DEFAULT_SETTINGS, type WorkTimeSettings } from "./domain/types";
import { createDevelopmentFixture, type CardUiState } from "./fixtures/developmentFixture";
import { createBlindCalculationFixture } from "./fixtures/blindCalculationFixture";
import { navigationTargetId, nextSettingTarget, nextWorkTarget, type PenaltyOccurrence } from "./ui/navigation";
import { photoLimitMessage as formatPhotoLimitMessage, planPhotoSelection } from "./ui/photoQueueLimit";
import { RecognitionWorkerClient, RecognitionWorkerCrashedError } from "./recognition/workerClient";
import { recognitionResultToCard } from "./recognition/recognitionUiAdapter";
import { clearWorkSession, loadWorkSession, saveWorkSession } from "./persistence/workSession";
import { createManualWorkRow, isWorkRowVisible } from "./ui/workRows";

interface ActiveEdit {
  target: EditTarget;
  draft: string;
}

type FontSizeSetting = "small" | "standard" | "large1" | "large2";
const FONT_SIZE_STORAGE_KEY = "timecard-font-size";
const CALCULATION_SETTINGS_STORAGE_KEY = "timecard-calculation-settings";
const DARK_MODE_STORAGE_KEY = "timecard-dark-mode";
const FONT_SIZE_OPTIONS: { value: FontSizeSetting; label: string }[] = [
  { value: "small", label: "小" },
  { value: "standard", label: "標準" },
  { value: "large1", label: "大1" },
  { value: "large2", label: "大2" },
];

function loadFontSize(): FontSizeSetting {
  try {
    const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (stored === "v2-small") return "small";
    if (stored === "v2-standard") return "standard";
    if (stored === "v2-large1") return "large1";
    if (stored === "v2-large2") return "large2";
    if (stored === "large1") return "standard";
    if (stored === "large2") return "large1";
    if (stored === "large3") return "large2";
    if (stored === "small2" || stored === "small1" || stored === "small" || stored === "standard" || stored === "large") return "small";
    return "standard";
  } catch {
    return "standard";
  }
}

function loadCalculationSettings(): WorkTimeSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CALCULATION_SETTINGS_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const value = parsed as Record<string, unknown>;
    const clockKeys = ["dayStart", "dayEnd", "noPayDayStart", "noPayDayEnd", "nightStart", "nightEnd", "noPayNightStart", "noPayNightEnd"] as const;
    if (!clockKeys.every((key) => typeof value[key] === "string") || typeof value.penaltyMinutes !== "number" || typeof value.penaltyEnabled !== "boolean") return { ...DEFAULT_SETTINGS };
    const candidate = Object.fromEntries([...clockKeys.map((key) => [key, value[key]]), ["noPayDayEnabled", typeof value.noPayDayEnabled === "boolean" ? value.noPayDayEnabled : true], ["noPayNightEnabled", typeof value.noPayNightEnabled === "boolean" ? value.noPayNightEnabled : true], ["penaltyMinutes", value.penaltyMinutes], ["penaltyEnabled", value.penaltyEnabled]]) as unknown as WorkTimeSettings;
    return validateSettings(candidate).valid ? candidate : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function loadDarkMode(): boolean {
  try {
    const stored = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    return stored === "true" ? true : stored === "false" ? false : false;
  } catch {
    return false;
  }
}

const TAP_THRESHOLD_PX = 10;
interface RecognitionClient { initialize:RecognitionWorkerClient['initialize'];processPhoto:RecognitionWorkerClient['processPhoto'];dispose:RecognitionWorkerClient['dispose'] }
interface AppProps { workerClientFactory?: () => RecognitionClient }
export default function App({workerClientFactory=()=>new RecognitionWorkerClient()}:AppProps) {
  const initialSettings = useMemo(loadCalculationSettings, []);
  const restoredSession = useMemo(loadWorkSession, []);
  const fixture = useMemo(
    () => restoredSession ?? (import.meta.env.PROD
      ? { cards: [], photos: [] }
      : import.meta.env.MODE === "test" ? createDevelopmentFixture() : createBlindCalculationFixture()),
    [restoredSession],
  );
  const [cards, setCards] = useState<CardUiState[]>(fixture.cards);
  const [photos, setPhotos] = useState(fixture.photos);
  const [displayNames, setDisplayNames] = useState<Record<string, string>>(() => restoredSession?.displayNames ?? Object.fromEntries(fixture.photos.map((photo) => [photo.id, photo.fileName])));
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<WorkTimeSettings>(initialSettings);
  const [settingsDraft, setSettingsDraft] = useState<WorkTimeSettings>(initialSettings);
  const [settingErrors, setSettingErrors] = useState<Partial<Record<EditableSettingKey, readonly string[]>>>({});
  const [darkMode, setDarkMode] = useState(loadDarkMode);
  const [fontSize, setFontSize] = useState<FontSizeSetting>(loadFontSize);
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [rowMenuTarget, setRowMenuTarget] = useState<{ cardId: string; rowId: string } | null>(null);
  const [penaltyOccurrence, setPenaltyOccurrence] = useState<PenaltyOccurrence>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(new Map<string,File>());
  const workerRef = useRef<RecognitionClient | undefined>(undefined);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const workSessionDirtyRef = useRef(false);
  const [processing,setProcessing]=useState(false);
  const [photoLimitMessage,setPhotoLimitMessage]=useState('');

  useEffect(()=>()=>{mountedRef.current=false;generationRef.current+=1;const worker=workerRef.current;workerRef.current=undefined;if(worker)void worker.dispose()},[]);

  useEffect(() => {
    if (!rowMenuTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setRowMenuTarget(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [rowMenuTarget]);

  useEffect(() => {
    if (!workSessionDirtyRef.current) return;
    workSessionDirtyRef.current = false;
    saveWorkSession({ cards, photos, displayNames });
  }, [cards, photos, displayNames]);

  useEffect(() => {
    try {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, `v2-${fontSize}`);
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }, [fontSize]);

  useEffect(() => {
    try {
      localStorage.setItem(CALCULATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(DARK_MODE_STORAGE_KEY, String(darkMode));
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }, [darkMode]);

  useLayoutEffect(() => {
    const alignPenaltyToggle = () => {
      const root = appRef.current;
      const penaltyToggle = root?.querySelector<HTMLElement>(".penalty-toggle");
      const darkModeToggle = root?.querySelector<HTMLElement>(".dark-mode-row .toggle");
      if (!root || !penaltyToggle || !darkModeToggle) return;
      const correction = darkModeToggle.getBoundingClientRect().left - penaltyToggle.getBoundingClientRect().left;
      if (Math.abs(correction) > 0.1) {
        const currentShift = Number.parseFloat(root.style.getPropertyValue("--penalty-toggle-shift-x")) || 0;
        root.style.setProperty("--penalty-toggle-shift-x", `${currentShift + correction}px`);
      }
      for (const toggle of root.querySelectorAll<HTMLElement>(".setting-inline-toggle")) {
        const inlineCorrection = penaltyToggle.getBoundingClientRect().left - toggle.getBoundingClientRect().left;
        if (Math.abs(inlineCorrection) > 0.1) {
          const currentShift = Number.parseFloat(toggle.style.getPropertyValue("--setting-toggle-shift-x")) || 0;
          toggle.style.setProperty("--setting-toggle-shift-x", `${currentShift + inlineCorrection}px`);
        }
      }
      for (const toggle of root.querySelectorAll<HTMLElement>(".setting-inline-toggle, .penalty-toggle")) {
        const cell = toggle.closest<HTMLElement>("th, td");
        if (!cell) continue;
        const toggleRect = toggle.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const verticalCorrection = (cellRect.top + cellRect.bottom - toggleRect.top - toggleRect.bottom) / 2;
        if (Math.abs(verticalCorrection) > 0.1) {
          const currentShift = Number.parseFloat(toggle.style.getPropertyValue("--setting-toggle-shift-y")) || 0;
          toggle.style.setProperty("--setting-toggle-shift-y", `${currentShift + verticalCorrection}px`);
        }
      }
    };
    let active = true;
    alignPenaltyToggle();
    const frame = requestAnimationFrame(alignPenaltyToggle);
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (active) alignPenaltyToggle();
      });
    }
    window.addEventListener("resize", alignPenaltyToggle);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", alignPenaltyToggle);
    };
  }, [fontSize]);

  useLayoutEffect(() => {
    const root = appRef.current;
    if (!root || !activeEdit) {
      root?.style.removeProperty("--keypad-height");
      return;
    }
    const keypad = root.querySelector<HTMLElement>(".keypad");
    if (!keypad) return;
    let frame = 0;
    const updateKeypadSpaceAndScroll = () => {
      root.style.setProperty("--keypad-height", `${keypad.getBoundingClientRect().height}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selectedCell = root.querySelector<HTMLElement>("[data-editable].is-editing");
        if (!selectedCell) return;
        const cellRect = selectedCell.getBoundingClientRect();
        const keypadRect = keypad.getBoundingClientRect();
        if (cellRect.height <= 0 || keypadRect.height <= 0) return;
        const keypadTop = keypadRect.top;
        const overlap = cellRect.bottom - (keypadTop - 12);
        if (overlap > 0) window.scrollBy({ top: overlap, left: 0, behavior: "auto" });
      });
    };
    updateKeypadSpaceAndScroll();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateKeypadSpaceAndScroll);
    observer?.observe(keypad);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeEdit?.target]);

  const calculationSettingsValid = useMemo(() => validateSettings(settingsDraft).valid, [settingsDraft]);
  const cardTotals = useMemo(() => calculationSettingsValid ? new Map(cards.map((card) => [
    card.id,
    calculateCardTotal(card.rows.map((row) => row.cells.map((cell) => cell.value) as [string | null, string | null, string | null, string | null]), card.exceptionMinutes ?? 0, settings),
  ])) : new Map<string, number>(), [calculationSettingsValid, cards, settings]);

  const commitActive = (close: boolean) => {
    if (!activeEdit) return;
    const { target, draft } = activeEdit;
    if (target.kind === "cell") {
      const result = commitTimeInput(draft);
      setCards((current) => current.map((card) => card.id !== target.cardId ? card : ({
        ...card,
        rows: card.rows.map((row) => row.rowId !== target.rowId ? row : ({
          ...row,
          cells: row.cells.map((cell, cellIndex) => {
            if (cellIndex !== target.cellIndex) return cell;
            const value = result.valid ? result.value : draft;
            const reviewAcknowledged = cell.reviewRequired || cell.reviewAcknowledged;
            const userModified = value !== cell.originalRecognizedValue;
            if (value !== cell.value || reviewAcknowledged !== cell.reviewAcknowledged || userModified !== cell.userModified || cell.recognitionIssue !== undefined) workSessionDirtyRef.current = true;
            return { ...cell, value, reviewAcknowledged, userModified, recognitionIssue: undefined };
          }) as typeof row.cells,
        })),
      })));
    } else if (target.kind === "exception") {
      const result = commitExceptionInput(draft);
      setCards((current) => current.map((card) => {
        if (card.id !== target.cardId) return card;
        const exceptionMinutes = result.valid ? result.value : null;
        const exceptionInvalidInput = result.valid ? null : draft;
        if (exceptionMinutes !== card.exceptionMinutes || exceptionInvalidInput !== card.exceptionInvalidInput) workSessionDirtyRef.current = true;
        return { ...card, exceptionMinutes, exceptionInvalidInput };
      }));
    } else if (target.kind === "setting") {
      const committed = target.key === "penaltyMinutes" ? commitPenalty(draft) : commitTimeInput(draft);
      if (committed.valid) {
        const candidate = { ...settingsDraft, [target.key]: committed.value } as WorkTimeSettings;
        setSettingsDraft(candidate);
        const validation = validateSettings(candidate);
        setSettingErrors(validation.fieldErrors);
        if (validation.valid) setSettings(candidate);
      } else {
        setSettingsDraft((current) => ({ ...current, [target.key]: draft }));
        setSettingErrors((current) => ({ ...current, [target.key]: committed.errors }));
      }
    }
    if (close) setActiveEdit(null);
  };

  const openEditor = (target: EditTarget, occurrence: PenaltyOccurrence = null, skipCommit = false) => {
    setRowMenuTarget(null);
    if (!skipCommit && activeEdit && navigationTargetId(activeEdit.target) !== navigationTargetId(target)) commitActive(false);
    setPenaltyOccurrence(target.kind === "setting" && target.key === "penaltyMinutes" ? (occurrence ?? "final") : null);
    if (target.kind === "cell") {
      const cell = cards.find((card) => card.id === target.cardId)?.rows.find((row) => row.rowId === target.rowId)?.cells[target.cellIndex];
      if (cell) setActiveEdit({ target, draft: cell.value?.replace(":", "") ?? "" });
    } else if (target.kind === "exception") {
      const card = cards.find((item) => item.id === target.cardId);
      if (card) {
        const draft = card.exceptionInvalidInput ?? `${String(Math.floor((card.exceptionMinutes ?? 0) / 60)).padStart(2, "0")}${String((card.exceptionMinutes ?? 0) % 60).padStart(2, "0")}`;
        setActiveEdit({ target, draft });
      }
    } else {
      setActiveEdit({ target, draft: String(settingsDraft[target.key]).replace(":", "") });
    }
  };

  const moveEditor = (direction: KeypadDirection) => {
    if (!activeEdit) return;
    setRowMenuTarget(null);
    const current = activeEdit.target;
    const result = current.kind === "setting"
      ? nextSettingTarget(current, direction, penaltyOccurrence)
      : { target: nextWorkTarget(cards, current, direction), penaltyOccurrence: null };
    commitActive(false);
    if (navigationTargetId(result.target) !== navigationTargetId(current)) {
      openEditor(result.target, result.penaltyOccurrence, true);
    } else {
      setPenaltyOccurrence(result.penaltyOccurrence);
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || !activeEdit) return;
    const target = event.target as Element;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_THRESHOLD_PX) return;
    if (target.closest("[data-row-action]")) return;
    if (rowMenuTarget) setRowMenuTarget(null);
    if (!target.closest("[data-editable], [data-keypad]")) commitActive(true);
  };

  const togglePenalty = () => {
    const candidate = { ...settingsDraft, penaltyEnabled: !settingsDraft.penaltyEnabled };
    setSettingsDraft(candidate);
    const validation = validateSettings(candidate);
    setSettingErrors(validation.fieldErrors);
    if (validation.valid) setSettings(candidate);
  };
  const toggleNoPay = (key: "noPayDayEnabled" | "noPayNightEnabled") => {
    const candidate = { ...settingsDraft, [key]: !settingsDraft[key] };
    setSettingsDraft(candidate);
    const validation = validateSettings(candidate);
    setSettingErrors(validation.fieldErrors);
    if (validation.valid) setSettings(candidate);
  };

  const reset = () => {
    generationRef.current+=1;
    const worker=workerRef.current;workerRef.current=undefined;if(worker)void worker.dispose();
    filesRef.current.clear();
    clearWorkSession();
    workSessionDirtyRef.current = false;
    setProcessing(false);
    setPhotoLimitMessage('');
    setCards([]);
    setPhotos([]);
    setDisplayNames({});
    setSelectedPhotoIds(new Set());
    setActiveEdit(null);
    setRowMenuTarget(null);
    setPenaltyOccurrence(null);
  };
  const deleteSelected = () => {
    if (photos.some((photo) => selectedPhotoIds.has(photo.id) && (photo.status === "完了" || photo.status === "エラー"))) workSessionDirtyRef.current = true;
    for(const id of selectedPhotoIds)filesRef.current.delete(id);
    setPhotos((current) => current.filter((photo) => !selectedPhotoIds.has(photo.id)));
    setCards((current) => current.filter((card) => !selectedPhotoIds.has(card.photoId)));
    setDisplayNames((current) => Object.fromEntries(Object.entries(current).filter(([photoId]) => !selectedPhotoIds.has(photoId))));
    setSelectedPhotoIds(new Set());
  };
  const changeDisplayName = (photoId: string, displayName: string) => {
    setDisplayNames((current) => {
      if (current[photoId] === displayName) return current;
      workSessionDirtyRef.current = true;
      return { ...current, [photoId]: displayName };
    });
  };

  const performRowOperation = (operation: RowOperation) => {
    if (!activeEdit || activeEdit.target.kind !== "cell") return;
    const { cardId, rowId, cellIndex } = activeEdit.target;
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    const rowIndex = card.rows.findIndex((row) => row.rowId === rowId);
    if (rowIndex < 0) return;
    const visibleRows = card.rows.filter(isWorkRowVisible);
    if (operation === "delete") {
      if (visibleRows.length <= 1) return;
      const visibleIndex = visibleRows.findIndex((row) => row.rowId === rowId);
      const nextRow = visibleRows[visibleIndex + 1] ?? visibleRows[visibleIndex - 1];
      workSessionDirtyRef.current = true;
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, rows: item.rows.filter((row) => row.rowId !== rowId) } : item));
      setActiveEdit(nextRow ? { target: { kind: "cell", cardId, rowId: nextRow.rowId, cellIndex }, draft: nextRow.cells[cellIndex].value?.replace(":", "") ?? "" } : null);
    } else {
      commitActive(false);
      const newRowId = typeof crypto.randomUUID === "function" ? `manual-${crypto.randomUUID()}` : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const insertedRow = createManualWorkRow(newRowId);
      const insertionIndex = operation === "insert-above" ? rowIndex : rowIndex + 1;
      workSessionDirtyRef.current = true;
      setCards((current) => current.map((item) => item.id !== cardId ? item : ({ ...item, rows: [...item.rows.slice(0, insertionIndex), insertedRow, ...item.rows.slice(insertionIndex)] })));
      setActiveEdit({ target: { kind: "cell", cardId, rowId: newRowId, cellIndex }, draft: "" });
    }
    setRowMenuTarget(null);
  };

  const addPhotos=(event:ChangeEvent<HTMLInputElement>)=>{
    const selected=Array.from(event.target.files??[]),{accepted,excludedCount}=planPhotoSelection(photos,selected),added=accepted.map((file,index)=>{const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():`photo-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;filesRef.current.set(id,file);return{id,fileName:file.name,status:'未処理' as const}})
    if(added.length){setPhotos(current=>[...current,...added]);setDisplayNames(current=>({...current,...Object.fromEntries(added.map(photo=>[photo.id,photo.fileName]))}))}
    setPhotoLimitMessage(formatPhotoLimitMessage(excludedCount));
    event.target.value='';
  };
  const calculate=async()=>{
    if(processing)return;
    const queue=photos.filter(photo=>photo.status==='未処理'&&filesRef.current.has(photo.id));if(!queue.length)return;
    const generation=generationRef.current;setProcessing(true);let client=workerRef.current;
    if(!client){client=workerClientFactory();workerRef.current=client;try{await client.initialize()}catch{if(mountedRef.current&&generation===generationRef.current){workSessionDirtyRef.current=true;setPhotos(current=>current.map(photo=>photo.id===queue[0].id?{...photo,status:'エラー'}:photo))}if(workerRef.current===client){workerRef.current=undefined;void client.dispose()}if(mountedRef.current&&generation===generationRef.current)setProcessing(false);return}}
    for(const photo of queue){if(!mountedRef.current||generation!==generationRef.current)break;const file=filesRef.current.get(photo.id);if(!file)continue;setPhotos(current=>current.map(item=>item.id===photo.id?{...item,status:'処理中'}:item));try{const result=await client.processPhoto(file);if(!mountedRef.current||generation!==generationRef.current||!filesRef.current.has(photo.id))continue;workSessionDirtyRef.current=true;setCards(current=>[...current.filter(card=>card.photoId!==photo.id),recognitionResultToCard(photo.id,photo.fileName,result)]);setPhotos(current=>current.map(item=>item.id===photo.id?{...item,status:'完了'}:item));filesRef.current.delete(photo.id)}catch(error){filesRef.current.delete(photo.id);if(!mountedRef.current||generation!==generationRef.current)break;workSessionDirtyRef.current=true;setPhotos(current=>current.map(item=>item.id===photo.id?{...item,status:'エラー'}:item));if(error instanceof RecognitionWorkerCrashedError){if(workerRef.current===client){workerRef.current=undefined;void client.dispose()}break}}}
    if(mountedRef.current&&generation===generationRef.current)setProcessing(false);
  };

  return (
    <div ref={appRef} className={`app ${darkMode ? "theme-dark" : "theme-light"} font-size-${fontSize}`} data-testid="app-shell" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
      <main className={`page ${activeEdit ? "keypad-open" : ""}`}>
        <header className="app-header"><h1>勤務時間計算アプリ</h1><button className="reset-button" type="button" onClick={reset}>リセット</button></header>
        <section className="top-controls" aria-label="写真操作">
          <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
          <button className="primary-button photo-add-button" type="button" disabled={processing} onClick={()=>fileInputRef.current?.click()}>写真を選択</button>
          {photoLimitMessage&&<p role="status">{photoLimitMessage}</p>}
          {photos.length > 0 && <PhotoQueue photos={photos} displayNames={displayNames} selectedIds={selectedPhotoIds} onSelectionChange={setSelectedPhotoIds} onDisplayNameChange={changeDisplayName} onDelete={deleteSelected} onCalculate={calculate} processing={processing} />}
        </section>
        {cards.map((card) => {
          const selectedRowId = activeEdit?.target.kind === "cell" && activeEdit.target.cardId === card.id ? activeEdit.target.rowId : null;
          const rowMenuOpen = selectedRowId !== null && rowMenuTarget?.cardId === card.id && rowMenuTarget.rowId === selectedRowId;
          return <TimeCardTable key={card.id} card={card} displayName={displayNames[card.photoId] ?? card.fileName} settings={settings} totalMinutes={cardTotals.get(card.id) ?? 0} calculationSettingsValid={calculationSettingsValid} activeTarget={activeEdit?.target ?? null} draft={activeEdit?.draft ?? ""} rowMenuOpen={rowMenuOpen} onEdit={openEditor} onToggleRowMenu={() => selectedRowId && setRowMenuTarget(rowMenuOpen ? null : { cardId: card.id, rowId: selectedRowId })} onRowOperation={performRowOperation} />;
        })}
        {cards.length > 0 && <TotalSummary cards={cards} displayNames={displayNames} totals={cardTotals} calculationSettingsValid={calculationSettingsValid} />}
        <CalculationSettings settings={settingsDraft} errors={settingErrors} activeTarget={activeEdit?.target ?? null} draft={activeEdit?.draft ?? ""} onEdit={openEditor} onTogglePenalty={togglePenalty} onToggleNoPayDay={() => toggleNoPay("noPayDayEnabled")} onToggleNoPayNight={() => toggleNoPay("noPayNightEnabled")} />
        <div className="dark-mode-row"><span>ダークモード</span><button className={`toggle ${darkMode ? "is-on" : ""}`} type="button" role="switch" aria-checked={darkMode} aria-label="ダークモード" onClick={() => setDarkMode((value) => !value)}><span /></button></div>
        <div className="font-size-row"><span>文字サイズ</span><div className="font-size-options" role="group" aria-label="文字サイズ">{FONT_SIZE_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={fontSize === option.value} onClick={() => setFontSize(option.value)}>{option.label}</button>)}</div></div>
      </main>
      {activeEdit && <CustomKeypad value={activeEdit.draft} onDigit={(digit) => setActiveEdit((current) => current ? { ...current, draft: `${current.draft}${digit}` } : current)} onDelete={() => setActiveEdit((current) => current ? { ...current, draft: current.draft.slice(0, -1) } : current)} onClearAll={() => setActiveEdit((current) => current ? { ...current, draft: "" } : current)} onMove={moveEditor} />}
    </div>
  );
}

function commitPenalty(input: string) {
  if (!/^\d+$/.test(input)) return { valid: false as const, value: null, errors: ["遅刻ペナルティは0以上の整数で入力してください"] };
  return { valid: true as const, value: Number(input), errors: [] as const };
}

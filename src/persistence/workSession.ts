import type { CardUiState, PhotoUiState, TimeCellUiState, WorkRowUiState } from "../fixtures/developmentFixture";

export const WORK_SESSION_STORAGE_KEY = "timecard-work-session";
export const WORK_SESSION_VERSION = 3;

export interface WorkSessionState {
  photos: PhotoUiState[];
  cards: CardUiState[];
  displayNames: Record<string, string>;
}

export interface StoredWorkSession extends WorkSessionState {
  version: typeof WORK_SESSION_VERSION;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNullableString = (value: unknown): value is string | null => typeof value === "string" || value === null;
const isOptionalString = (value: unknown): value is string | undefined => typeof value === "undefined" || typeof value === "string";

function isCell(value: unknown): value is TimeCellUiState {
  if (!isRecord(value)) return false;
  return isNullableString(value.value)
    && isNullableString(value.originalRecognizedValue)
    && typeof value.reviewRequired === "boolean"
    && typeof value.reviewAcknowledged === "boolean"
    && typeof value.userModified === "boolean"
    && (typeof value.recognitionIssue === "undefined" || value.recognitionIssue === "suspicious_content" || value.recognitionIssue === "recognition_failed")
    && (typeof value.recognitionReviewReasons === "undefined" || (isRecord(value.recognitionReviewReasons)
      && typeof value.recognitionReviewReasons.recognizer === "boolean"
      && typeof value.recognitionReviewReasons.routeDisagreement === "boolean"
      && typeof value.recognitionReviewReasons.cropFailure === "boolean"));
}

function isLegacyRow(value: unknown): boolean {
  return isRecord(value)
    && Number.isInteger(value.sourceRowIndex)
    && Array.isArray(value.cells)
    && value.cells.length === 4
    && value.cells.every(isCell);
}

function isCard(value: unknown): value is CardUiState {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.photoId === "string"
    && typeof value.fileName === "string"
    && Array.isArray(value.rows)
    && value.rows.every(isLegacyRow)
    && (value.exceptionMinutes === null || (typeof value.exceptionMinutes === "number" && Number.isFinite(value.exceptionMinutes)))
    && isNullableString(value.exceptionInvalidInput);
}

function isPhoto(value: unknown): value is PhotoUiState {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.fileName === "string"
    && (value.status === "完了" || value.status === "エラー");
}

function parseSession(value: unknown): StoredWorkSession | null {
  if (!isRecord(value)
    || (value.version !== 1 && value.version !== 2 && value.version !== WORK_SESSION_VERSION)
    || !Array.isArray(value.photos)
    || !value.photos.every(isPhoto)
    || !Array.isArray(value.cards)
    || !value.cards.every(isCard)
    || !isRecord(value.displayNames)
    || !Object.values(value.displayNames).every(isOptionalString)) return null;

  const photoIds = new Set(value.photos.map((photo) => photo.id));
  if (photoIds.size !== value.photos.length
    || value.cards.some((card) => !photoIds.has(card.photoId))
    || Object.keys(value.displayNames).some((id) => !photoIds.has(id))) return null;
  const cards = (value.cards as CardUiState[]).map((card) => ({
    ...card,
    rows: card.rows.map((row, index) => ({
      ...row,
      rowId: typeof row.rowId === "string" && row.rowId.length > 0 ? row.rowId : `recognized-${row.sourceRowIndex}-${index}`,
      manuallyInserted: row.manuallyInserted === true,
    })),
  }));
  if (cards.some((card) => new Set(card.rows.map((row) => row.rowId)).size !== card.rows.length)) return null;
  return {
    version: WORK_SESSION_VERSION,
    photos: value.photos,
    cards,
    displayNames: value.displayNames as Record<string, string>,
  };
}

export function loadWorkSession(storage: StorageLike = localStorage): StoredWorkSession | null {
  try {
    const raw = storage.getItem(WORK_SESSION_STORAGE_KEY);
    if (raw === null) return null;
    const session = parseSession(JSON.parse(raw));
    if (!session) {
      storage.removeItem(WORK_SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    try { storage.removeItem(WORK_SESSION_STORAGE_KEY); } catch { /* Storage is unavailable. */ }
    return null;
  }
}

export function createRestorableState(state: WorkSessionState): WorkSessionState {
  const restorablePhotos = state.photos
    .filter((photo) => photo.status === "完了" || photo.status === "エラー")
    .map((photo) => ({ id: photo.id, fileName: photo.fileName, status: photo.status }));
  const photoIds = new Set(restorablePhotos.map((photo) => photo.id));
  return {
    photos: restorablePhotos,
    cards: state.cards.filter((card) => photoIds.has(card.photoId)).map((card) => ({
      id: card.id,
      photoId: card.photoId,
      fileName: card.fileName,
      rows: card.rows.map((row) => ({
        rowId: row.rowId,
        sourceRowIndex: row.sourceRowIndex,
        manuallyInserted: row.manuallyInserted,
        cells: row.cells.map((cell) => ({
          value: cell.value,
          originalRecognizedValue: cell.originalRecognizedValue,
          reviewRequired: cell.reviewRequired,
          reviewAcknowledged: cell.reviewAcknowledged,
          userModified: cell.userModified,
          ...(cell.recognitionIssue === undefined ? {} : { recognitionIssue: cell.recognitionIssue }),
          ...(cell.recognitionReviewReasons === undefined ? {} : { recognitionReviewReasons: { ...cell.recognitionReviewReasons } }),
        })) as WorkRowUiState["cells"],
      })),
      exceptionMinutes: card.exceptionMinutes,
      exceptionInvalidInput: card.exceptionInvalidInput,
    })),
    displayNames: Object.fromEntries(Object.entries(state.displayNames).filter(([id]) => photoIds.has(id))),
  };
}

export function saveWorkSession(state: WorkSessionState, storage: StorageLike = localStorage): StoredWorkSession | null {
  const restorable = createRestorableState(state);
  if (restorable.photos.length === 0 && restorable.cards.length === 0) {
    clearWorkSession(storage);
    return null;
  }
  const session: StoredWorkSession = { version: WORK_SESSION_VERSION, ...restorable };
  try {
    storage.setItem(WORK_SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  } catch {
    return null;
  }
}

export function clearWorkSession(storage: StorageLike = localStorage): void {
  try { storage.removeItem(WORK_SESSION_STORAGE_KEY); } catch { /* Storage is unavailable. */ }
}

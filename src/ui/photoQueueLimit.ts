import type { PhotoUiState } from "../fixtures/developmentFixture";

export const MAX_ACTIVE_PHOTOS = 20;

export interface PhotoSelectionPlan<T> {
  accepted: T[];
  excludedCount: number;
}

export function planPhotoSelection<T>(
  photos: readonly Pick<PhotoUiState, "status">[],
  selected: readonly T[],
): PhotoSelectionPlan<T> {
  const activeCount = photos.filter(
    (photo) => photo.status === "未処理" || photo.status === "処理中",
  ).length;
  const remainingCapacity = Math.max(0, MAX_ACTIVE_PHOTOS - activeCount);
  const accepted = selected.slice(0, remainingCapacity);
  return { accepted, excludedCount: selected.length - accepted.length };
}

export function photoLimitMessage(excludedCount: number): string {
  return excludedCount > 0
    ? `${excludedCount}枚は上限を超えたため追加されませんでした`
    : "";
}

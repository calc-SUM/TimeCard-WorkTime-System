import type { CropRouteName, CropRouteResult } from './routeSelector'
import type { RegistrationQa } from './recognitionTypes'

export type RecognitionProgressStage = 'registration' | 'presence' | 'cropping' | 'recognition' | 'completed'

export interface WorkerInitializeRequest { type: 'initialize'; requestId: string }
export interface WorkerProcessPhotoRequest { type: 'processPhoto'; requestId: string; bytes: ArrayBuffer; mimeType: string }
export interface WorkerDisposeRequest { type: 'dispose'; requestId: string }
export type RecognitionWorkerRequest = WorkerInitializeRequest | WorkerProcessPhotoRequest | WorkerDisposeRequest

export interface WorkerCellResult {
  row: number
  column: 1 | 2 | 3 | 4
  classification: 'blank' | 'machine_stamp' | 'suspicious_content'
  issueType?: 'suspicious_content'
  time?: string
  selectedRoute?: CropRouteName
  recognizerReview?: boolean
  routePredictionDisagreement?: boolean
  cropFailureReview?: boolean
  finalReview?: boolean
  routes?: Record<CropRouteName, { prediction?: string; reviewRequired: boolean; failure?: CropRouteResult['failure'] }>
}

export interface WorkerPhotoResult {
  cells: WorkerCellResult[]
  qa: RegistrationQa
  routeCounts: Record<CropRouteName, number>
  timing: { h44H17Ms: number; presenceCropMs: number; recognizerMs: number; totalMs: number }
}

export interface WorkerInitializedResponse { type: 'initialized'; requestId: string; version: string | null; smoke: { mat: true; getBuildInformation: true; resize: true; warpPerspective: true }; timing: { openCvInitializationMs: number; recognizerInitializationMs: number } }
export interface WorkerProgressResponse { type: 'progress'; requestId: string; stage: RecognitionProgressStage }
export interface WorkerCompletedResponse { type: 'completed'; requestId: string; result: WorkerPhotoResult }
export interface WorkerFailedResponse { type: 'failed'; requestId: string; reason: string }
export interface WorkerDisposedResponse { type: 'disposed'; requestId: string }
export type RecognitionWorkerResponse = WorkerInitializedResponse | WorkerProgressResponse | WorkerCompletedResponse | WorkerFailedResponse | WorkerDisposedResponse

export function isTerminalWorkerResponse(response: RecognitionWorkerResponse): boolean {
  return response.type === 'initialized' || response.type === 'completed' || response.type === 'failed' || response.type === 'disposed'
}

import {
  TimeCardRecognizer,
  type GlyphBox as RecognizerGlyphBox,
  type GrayImage as RecognizerGrayImage,
  type HybridNormalizerRule,
  type HybridRecognitionResult,
  type RecognizerModelJson,
} from '../../spec/TimeCard_WorkTime_System_Final_Spec_v1.1/recognizer/src/timecardRecognizer'
import modelJson from '../../spec/TimeCard_WorkTime_System_Final_Spec_v1.1/recognizer/model/timecard_template_model_v1.json'
import hybridRuleJson from '../../spec/TimeCard_WorkTime_System_Final_Spec_v1.1/recognizer/config/hybrid_normalizer_rule_v1.json'
import type { CropRouteName, CropRouteResult, GlyphBox } from './routeSelector'
import type { GrayImage } from './recognitionTypes'

export interface RecognizerLike {
  recognize(glyphs: RecognizerGrayImage[], boxes: RecognizerGlyphBox[]): HybridRecognitionResult
}

export interface RouteRecognition {
  route: CropRouteName
  prediction?: string
  reviewRequired: boolean
  result?: HybridRecognitionResult
  failure?: CropRouteResult['failure']
}

export interface CellRecognition {
  selectedRoute: CropRouteName
  prediction?: string
  recognizerReview: boolean
  routePredictionDisagreement: boolean
  cropFailureReview: boolean
  finalReview: boolean
}

let fixedRecognizer: TimeCardRecognizer | undefined

export function getFixedRecognizer(): TimeCardRecognizer {
  fixedRecognizer ??= new TimeCardRecognizer(
    modelJson as unknown as RecognizerModelJson,
    hybridRuleJson as unknown as HybridNormalizerRule,
  )
  return fixedRecognizer
}

export function adaptGrayImages(glyphs: readonly GrayImage[]): RecognizerGrayImage[] {
  if (glyphs.length !== 5) throw new Error('Exactly five glyphs are required in H,H,:,M,M order')
  return glyphs.map((glyph) => ({ width: glyph.width, height: glyph.height, data: glyph.data }))
}

export function adaptGlyphBoxes(boxes: readonly GlyphBox[]): RecognizerGlyphBox[] {
  if (boxes.length !== 5) throw new Error('Exactly five glyph boxes are required in H,H,:,M,M order')
  return boxes.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }))
}

export function recognizeCropRoute(recognizer: RecognizerLike, crop: CropRouteResult): RouteRecognition {
  if (crop.failure || !crop.glyphs || !crop.boxes) {
    return { route: crop.route, reviewRequired: false, failure: crop.failure ?? 'empty' }
  }
  const result = recognizer.recognize(adaptGrayImages(crop.glyphs), adaptGlyphBoxes(crop.boxes))
  return { route: crop.route, prediction: result.time, reviewRequired: result.review_required, result }
}

export function assembleCellRecognition(
  selectedRoute: CropRouteName,
  routes: Readonly<Record<CropRouteName, RouteRecognition>>,
): CellRecognition {
  const selected = routes[selectedRoute]
  // The frozen H81 scorer includes a failed route as None when detecting disagreement.
  const predictions = new Set([routes.H75.prediction ?? null, routes.H76.prediction ?? null, routes.H78.prediction ?? null])
  const routePredictionDisagreement = predictions.size > 1
  const cropFailureReview = [routes.H75, routes.H76, routes.H78].some((route) => route.failure !== undefined)
  const recognizerReview = selected.reviewRequired
  return {
    selectedRoute,
    prediction: selected.prediction,
    recognizerReview,
    routePredictionDisagreement,
    cropFailureReview,
    finalReview: recognizerReview || routePredictionDisagreement,
  }
}

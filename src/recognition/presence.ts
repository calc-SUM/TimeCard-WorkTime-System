import { percentile } from './imageProcessing'
import type { CvMat, OpenCv } from './opencvTypes'
import type { GrayImage, RowBoundaryModel } from './recognitionTypes'

export type PresenceClass = 'machine_stamp' | 'suspicious_content' | 'blank'

export interface PresenceFeatures {
  contrast: number
  strongDarkness: number
  largestComponent: number
  componentRatio: number
  componentsAtLeastTwoPixels: number
}

export interface PresenceCellResult extends PresenceFeatures {
  row: number
  column: 1 | 2 | 3 | 4
  classification: PresenceClass
}

export interface PresenceTiming {
  cellWarpMs: number
  featureExtractionMs: number
  connectedComponentsMs: number
  totalMs: number
}

export interface PresenceCardResult {
  cells: PresenceCellResult[]
  timing: PresenceTiming
}

const CELL_WIDTH = 94
const CELL_HEIGHT = 32

export function connectedComponents8(mask: Uint8Array, width: number, height: number): number[] {
  if (mask.length !== width * height) throw new Error('mask dimensions do not match')
  const seen = new Uint8Array(mask.length)
  const areas: number[] = []
  const stack: number[] = []
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue
    seen[start] = 1
    stack.push(start)
    let area = 0
    while (stack.length) {
      const index = stack.pop()!
      area += 1
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const next = ny * width + nx
          if (mask[next] && !seen[next]) {
            seen[next] = 1
            stack.push(next)
          }
        }
      }
    }
    areas.push(area)
  }
  return areas
}

export function extractPresenceFeatures(cell: GrayImage): PresenceFeatures & { connectedComponentsMs: number } {
  if (cell.width !== CELL_WIDTH || cell.height !== CELL_HEIGHT) throw new Error('Presence requires a 94x32 cell')
  // Python cell[4:-4, 8:88]: y=4..27 and x=8..87 (exclusive ends 28 and 88).
  const interior = new Float32Array(24 * 80)
  let n = 0
  for (let y = 4; y < 28; y += 1) {
    for (let x = 8; x < 88; x += 1) interior[n++] = cell.data[y * CELL_WIDTH + x]
  }
  const p90 = percentile(interior, 90)
  const p10 = percentile(interior, 10)
  const low = percentile(interior, 4)
  const contrast = p90 - p10
  const scale = 220 / Math.max(p90 - low, 28)
  const strong = new Uint8Array(interior.length)
  let strongDarkness = 0
  for (let i = 0; i < interior.length; i += 1) {
    const darkness = Math.max(0, Math.min(255, (p90 - interior[i]) * scale))
    if (darkness >= 80) {
      strong[i] = 1
      strongDarkness += 1
    }
  }
  const componentStarted = performance.now()
  const areas = connectedComponents8(strong, 80, 24)
  const connectedComponentsMs = performance.now() - componentStarted
  const largestComponent = areas.length ? Math.max(...areas) : 0
  return {
    contrast,
    strongDarkness,
    largestComponent,
    componentRatio: largestComponent / Math.max(strongDarkness, 1),
    componentsAtLeastTwoPixels: areas.filter((area) => area >= 2).length,
    connectedComponentsMs,
  }
}

export function classifyPresence(features: Pick<PresenceFeatures, 'contrast' | 'componentRatio'>): PresenceClass {
  if (features.contrast < 20) return 'blank'
  return features.componentRatio < 0.4 ? 'machine_stamp' : 'suspicious_content'
}

function lineY(line: { slope: number; intercept: number }, x: number): number {
  return line.slope * x + line.intercept
}

export function evaluatePresenceCard(
  cv: OpenCv,
  rectified: GrayImage,
  geometry: RowBoundaryModel,
): PresenceCardResult {
  if (rectified.width !== 570 || rectified.height !== 950) throw new Error('Presence requires the H44 570x950 image')
  if (geometry.rows.length !== 31) throw new Error('Presence requires 31 H17 rows')
  const started = performance.now()
  let cellWarpMs = 0
  let featureExtractionMs = 0
  let connectedComponentsMs = 0
  const source = new cv.Mat(950, 570, cv.CV_8UC1)
  source.data.set(rectified.data)
  const cells: PresenceCellResult[] = []
  try {
    for (let row = 0; row < 31; row += 1) {
      const { top, bottom } = geometry.rows[row]
      for (let column = 1; column <= 4; column += 1) {
        const left = (column - 1) * CELL_WIDTH
        const right = left + CELL_WIDTH
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
          left, lineY(top, left), right, lineY(top, right),
          right, lineY(bottom, right), left, lineY(bottom, left),
        ])
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 94, 0, 94, 32, 0, 32])
        let transform: CvMat | undefined
        let warped: CvMat | undefined
        try {
          const warpStarted = performance.now()
          transform = cv.getPerspectiveTransform(srcPoints, dstPoints)
          warped = new cv.Mat()
          cv.warpPerspective(source, warped, transform, new cv.Size(94, 32), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255))
          cellWarpMs += performance.now() - warpStarted
          const featureStarted = performance.now()
          const features = extractPresenceFeatures({ width: 94, height: 32, data: new Uint8Array(warped.data) })
          const featureElapsed = performance.now() - featureStarted
          connectedComponentsMs += features.connectedComponentsMs
          featureExtractionMs += featureElapsed - features.connectedComponentsMs
          cells.push({
            row,
            column: column as 1 | 2 | 3 | 4,
            classification: classifyPresence(features),
            contrast: features.contrast,
            strongDarkness: features.strongDarkness,
            largestComponent: features.largestComponent,
            componentRatio: features.componentRatio,
            componentsAtLeastTwoPixels: features.componentsAtLeastTwoPixels,
          })
        } finally {
          srcPoints.delete()
          dstPoints.delete()
          transform?.delete()
          warped?.delete()
        }
      }
    }
  } finally {
    source.delete()
  }
  return { cells, timing: { cellWarpMs, featureExtractionMs, connectedComponentsMs, totalMs: performance.now() - started } }
}

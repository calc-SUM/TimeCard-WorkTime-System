import { mean, percentile, std } from './imageProcessing'
import type { GrayImage } from './recognitionTypes'

export interface GlyphBox { x1: number; y1: number; x2: number; y2: number }
export type CropRouteName = 'H75' | 'H76' | 'H78'
export interface CropRouteResult {
  route: CropRouteName
  bounds?: number[]
  boxes?: GlyphBox[]
  glyphs?: GrayImage[]
  colonX?: number
  band?: [number, number]
  failure?: 'no_boundaries' | 'quiet_fail' | 'empty'
  structureCost: number
  structureComponents?: StructureCostComponents
}

export interface StructureCostComponents { edgeContact: number; topBottomContact: number; verticalCenterStd: number; widthCoefficient: number }

function darkness(image: GrayImage): Float32Array {
  const values = Float32Array.from(image.data)
  const background = percentile(values, 90)
  const low = percentile(values, 4)
  const scale = 220 / Math.max(background - low, 28)
  return Float32Array.from(values, (value) => Math.max(0, Math.min(255, (background - value) * scale)))
}

export function structureCostComponents(result: Pick<CropRouteResult, 'glyphs'>): StructureCostComponents | undefined {
  if (!result.glyphs || result.glyphs.length !== 5) return undefined
  const edge: number[] = []
  const topBottom: number[] = []
  const verticalCenters: number[] = []
  const widths: number[] = []
  for (const index of [0, 1, 3, 4]) {
    const glyph = result.glyphs[index]
    const dark = darkness(glyph)
    const ink = Uint8Array.from(dark, (value) => value >= 36 ? 1 : 0)
    const total = Math.max(1, ink.reduce((sum, value) => sum + value, 0))
    const borderWidth = Math.max(1, Math.min(2, Math.floor(glyph.width / 3)))
    const borderHeight = Math.max(1, Math.min(2, Math.floor(glyph.height / 4)))
    let edgeInk = 0
    let topBottomInk = 0
    let ySum = 0
    let yCount = 0
    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1) {
        if (!ink[y * glyph.width + x]) continue
        if (x < borderWidth || x >= glyph.width - borderWidth) edgeInk += 1
        if (y < borderHeight || y >= glyph.height - borderHeight) topBottomInk += 1
        ySum += y
        yCount += 1
      }
    }
    edge.push(edgeInk / total)
    topBottom.push(topBottomInk / total)
    verticalCenters.push(yCount ? (ySum / yCount) / Math.max(1, glyph.height - 1) : 0.5)
    widths.push(glyph.width)
  }
  return { edgeContact: mean(edge), topBottomContact: mean(topBottom), verticalCenterStd: std(verticalCenters), widthCoefficient: std(widths) / Math.max(mean(widths), 1) }
}

export function structureCost(result: Pick<CropRouteResult, 'glyphs'>): number {
  const components = structureCostComponents(result)
  if (!components) return 999
  return 4 * components.edgeContact + 1.5 * components.topBottomContact + 2 * components.verticalCenterStd + 2 * components.widthCoefficient
}

export function selectCropRoute(routes: readonly CropRouteResult[]): CropRouteResult {
  if (!routes.length) throw new Error('No crop routes')
  // Python min() keeps the first item on a cost tie: H75, then H76, then H78.
  let selected = routes[0]
  for (let index = 1; index < routes.length; index += 1) {
    if (routes[index].structureCost < selected.structureCost) selected = routes[index]
  }
  return selected
}

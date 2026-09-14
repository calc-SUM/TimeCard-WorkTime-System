/*
 * TimeCard Recognizer Baseline v1.0.0
 * Browser/TypeScript implementation.
 *
 * Fixed production baseline:
 * - Hybrid normalizer (Original / Edge route)
 * - V1-style two-nearest-template classifier
 * - valid HH:MM decoder
 * - review_score only for review decisions
 *
 * Explicitly NOT used:
 * - pairwise verifier
 * - structural-feature verifier
 * - candidate_margin as a review trigger
 */

export interface GrayImage {
  width: number;
  height: number;
  /** Grayscale values in row-major order, 0=black, 255=white. */
  data: ArrayLike<number>;
}

export interface GlyphBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface HybridNormalizerRule {
  schema: string;
  primary_route: {
    use_edge_when: {
      scale_gain_gte: number;
      max_edge_horizontal_span_ratio_gte: number;
    };
  };
  dual_route_escalation: {
    run_alternate_when_all: {
      primary_review_score_gte: number;
      scale_gain_gte: number;
      max_edge_horizontal_span_ratio_gte: number;
    };
  };
}

interface TemplateJson {
  sample_id: string;
  label: string;
  group_pixels_u8: number[];
  shape_pixels_u8: number[];
  row_projection: number[];
  column_projection: number[];
}

export interface RecognizerModelJson {
  schema: string;
  labels: string[];
  normalisation: {
    canvas: [number, number];
    feature_pixels: [number, number];
    target_digit_band_y: [number, number];
    safe_margin: number;
    binary_threshold: number;
  };
  classifier: {
    templates_per_label: number;
    pixel_shift_tolerance: number;
    distance_weights: {
      group_shifted_pixels: number;
      group_shifted_binary: number;
      row_and_column_projections: number;
      shape_shifted_pixels: number;
      shape_shifted_binary: number;
    };
    position_constraints: Record<string, string[]>;
    review_policy: {
      review_when_score_gte: number;
    };
  };
  templates: TemplateJson[];
}

export interface CharacterRecognition {
  position: number;
  predicted: string;
  score: number;
  relative_margin: number;
  nearest_samples: string[];
}

export interface RecognitionResult {
  time: string;
  review_required: boolean;
  review_score: number;
  review_threshold: number;
  /** Diagnostic only. Never used as a review trigger in the fixed baseline. */
  candidate_margin: number;
  characters: CharacterRecognition[];
  scope: string;
}

export interface HybridRecognitionResult extends RecognitionResult {
  hybrid: {
    primary: "original" | "edge";
    chosen: "original" | "edge";
    dual_route: boolean;
    scale_gain: number;
    max_edge_horizontal_span_ratio: number;
  };
}

interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface InkData {
  darkness: Float32Array;
  width: number;
  height: number;
  bbox: BBox;
}

interface VariantData extends InkData {
  box: GlyphBox;
}

interface AnalyzedGlyph {
  charIndex: number;
  original: VariantData;
  edge: VariantData;
}

interface Geometry {
  scale: number;
  verticalOffset: number;
}

interface FeatureSet {
  group: Float32Array;
  shape: Float32Array;
  rows: Float32Array;
  columns: Float32Array;
}

interface PreparedTemplate {
  sampleId: string;
  labelIndex: number;
  group: Float32Array;
  shape: Float32Array;
  rows: Float32Array;
  columns: Float32Array;
  groupBinary: Uint32Array;
  shapeBinary: Uint32Array;
}

const INK_THRESHOLD = 36;
const EDGE_TRIM_PX = 2;

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) throw new Error("median() requires at least one value");
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** NumPy-compatible linear percentile for the small crop arrays used here. */
function percentile(data: ArrayLike<number>, p: number): number {
  const values = Array.from(data, Number).sort((a, b) => a - b);
  if (!values.length) throw new Error("percentile() requires pixels");
  const index = ((values.length - 1) * p) / 100;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return values[lo];
  const t = index - lo;
  return values[lo] * (1 - t) + values[hi] * t;
}

function analyzeInk(image: GrayImage): InkData {
  if (image.width <= 0 || image.height <= 0 || image.data.length !== image.width * image.height) {
    throw new Error("Invalid GrayImage dimensions/data length");
  }
  const background = percentile(image.data, 90);
  const contrast = Math.max(background - percentile(image.data, 4), 28);
  const darkness = new Float32Array(image.data.length);
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < image.data.length; i++) {
    const d = clamp255((background - Number(image.data[i])) * (220 / contrast));
    darkness[i] = d;
    if (d >= INK_THRESHOLD) {
      const y = Math.floor(i / image.width);
      const x = i - y * image.width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("No glyph ink detected");
  return {
    darkness,
    width: image.width,
    height: image.height,
    bbox: { x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 },
  };
}

function cropGrayVertical(image: GrayImage, trim: number): GrayImage {
  if (image.height <= trim * 2) throw new Error("Glyph is too short for edge route");
  const height = image.height - trim * 2;
  const out = new Float32Array(image.width * height);
  for (let y = 0; y < height; y++) {
    const source = (y + trim) * image.width;
    const target = y * image.width;
    for (let x = 0; x < image.width; x++) out[target + x] = Number(image.data[source + x]);
  }
  return { width: image.width, height, data: out };
}

function edgeHorizontalSpanRatio(ink: InkData, top: boolean, trim: number): number {
  let minX = ink.width;
  let maxX = -1;
  const yStart = top ? 0 : Math.max(0, ink.height - trim);
  const yEnd = top ? Math.min(trim, ink.height) : ink.height;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < ink.width; x++) {
      if (ink.darkness[y * ink.width + x] >= INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return maxX < 0 ? 0 : (maxX - minX + 1) / Math.max(ink.width, 1);
}

function geometry(
  items: AnalyzedGlyph[],
  variant: "original" | "edge",
  canvasW: number,
  canvasH: number,
  targetTop: number,
  targetBottom: number,
  safeMargin: number,
): Geometry {
  const enriched = items.map((item) => {
    const d = item[variant];
    return {
      charIndex: item.charIndex,
      abs: {
        x1: d.box.x1 + d.bbox.x1,
        y1: d.box.y1 + d.bbox.y1,
        x2: d.box.x1 + d.bbox.x2,
        y2: d.box.y1 + d.bbox.y2,
      },
    };
  });
  const digits = enriched.filter((v) => v.charIndex !== 2).map((v) => v.abs);
  const commonTop = median(digits.map((v) => v.y1));
  const commonBottom = median(digits.map((v) => v.y2));
  const commonHeight = Math.max(commonBottom - commonTop, 1);
  const all = enriched.map((v) => v.abs);
  const fullSpan = Math.max(...all.map((v) => v.y2)) - Math.min(...all.map((v) => v.y1));
  const maxWidth = Math.max(...all.map((v) => v.x2 - v.x1));
  const scale = Math.min(
    (targetBottom - targetTop) / commonHeight,
    (canvasH - 2 * safeMargin) / Math.max(fullSpan, 1),
    (canvasW - 2 * safeMargin) / Math.max(maxWidth, 1),
  );
  let verticalOffset = targetTop - commonTop * scale;
  const projectedMin = Math.min(...all.map((v) => v.y1)) * scale + verticalOffset;
  if (projectedMin < safeMargin) verticalOffset += safeMargin - projectedMin;
  const projectedMax = Math.max(...all.map((v) => v.y2)) * scale + verticalOffset;
  if (projectedMax > canvasH - safeMargin) {
    verticalOffset -= projectedMax - (canvasH - safeMargin);
  }
  return { scale, verticalOffset };
}

function cubicWeight(x: number): number {
  // Catmull-Rom / Keys cubic, a=-0.5. Deterministic browser-independent resizing.
  const a = -0.5;
  const t = Math.abs(x);
  if (t <= 1) return (a + 2) * t * t * t - (a + 3) * t * t + 1;
  if (t < 2) return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
  return 0;
}

function resizeBicubic(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.floor(sy);
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.floor(sx);
      let sum = 0;
      let weightSum = 0;
      for (let j = -1; j <= 2; j++) {
        const yy = Math.min(sh - 1, Math.max(0, y0 + j));
        const wy = cubicWeight(sy - (y0 + j));
        for (let i = -1; i <= 2; i++) {
          const xx = Math.min(sw - 1, Math.max(0, x0 + i));
          const w = wy * cubicWeight(sx - (x0 + i));
          sum += src[yy * sw + xx] * w;
          weightSum += w;
        }
      }
      out[y * dw + x] = clamp255(weightSum === 0 ? 0 : sum / weightSum);
    }
  }
  return out;
}

function pasteMax(
  dst: Float32Array,
  dstW: number,
  dstH: number,
  src: Float32Array,
  srcW: number,
  srcH: number,
  left: number,
  top: number,
): void {
  const x1 = Math.max(0, left);
  const y1 = Math.max(0, top);
  const x2 = Math.min(dstW, left + srcW);
  const y2 = Math.min(dstH, top + srcH);
  if (x2 <= x1 || y2 <= y1) return;
  for (let y = y1; y < y2; y++) {
    const sy = y - top;
    for (let x = x1; x < x2; x++) {
      const si = sy * srcW + (x - left);
      const di = y * dstW + x;
      if (src[si] > dst[di]) dst[di] = src[si];
    }
  }
}

function renderNormalized(
  items: AnalyzedGlyph[],
  geo: Geometry,
  variant: "original" | "edge",
  canvasW: number,
  canvasH: number,
  safeMargin: number,
): Float32Array[] {
  return items.map((item) => {
    const d = item[variant];
    const resizedW = Math.max(1, Math.round(d.width * geo.scale));
    const resizedH = Math.max(1, Math.round(d.height * geo.scale));
    const resized = resizeBicubic(d.darkness, d.width, d.height, resizedW, resizedH);
    const inkCenterSource = (d.bbox.x1 + d.bbox.x2) / 2;
    const left = Math.round(canvasW / 2 - inkCenterSource * geo.scale);
    const top = Math.round(d.box.y1 * geo.scale + geo.verticalOffset);
    const canvas = new Float32Array(canvasW * canvasH);
    pasteMax(canvas, canvasW, canvasH, resized, resizedW, resizedH, left, top);
    for (let y = 0; y < canvasH; y++) {
      for (let x = 0; x < canvasW; x++) {
        const border = y < safeMargin || y >= canvasH - safeMargin || x < safeMargin || x >= canvasW - safeMargin;
        const i = y * canvasW + x;
        if (border && canvas[i] > 0 && canvas[i] <= INK_THRESHOLD) canvas[i] = 0;
      }
    }
    return canvas;
  });
}

/** Area/BOX resize matching the classifier's downsampling intent. */
function resizeArea(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * scaleY;
    const y1 = (dy + 1) * scaleY;
    const sy0 = Math.floor(y0);
    const sy1 = Math.ceil(y1);
    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * scaleX;
      const x1 = (dx + 1) * scaleX;
      const sx0 = Math.floor(x0);
      const sx1 = Math.ceil(x1);
      let sum = 0;
      let area = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        if (sy < 0 || sy >= sh) continue;
        const oy = Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
        if (oy <= 0) continue;
        for (let sx = sx0; sx < sx1; sx++) {
          if (sx < 0 || sx >= sw) continue;
          const ox = Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx));
          const a = ox * oy;
          if (a > 0) {
            sum += src[sy * sw + sx] * a;
            area += a;
          }
        }
      }
      // Python rounds to uint8 before /255.
      out[dy * dw + dx] = Math.round(clamp255(area > 0 ? sum / area : 0)) / 255;
    }
  }
  return out;
}

function cropDarknessToInk(src: Float32Array, width: number, height: number): { data: Float32Array; width: number; height: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (src[y * width + x] >= INK_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("Normalized glyph has no ink");
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) out[y * cw + x] = src[(y + minY) * width + x + minX];
  }
  return { data: out, width: cw, height: ch };
}

function makeFeatures(darkness: Float32Array, canvasW: number, canvasH: number, width: number, height: number): FeatureSet {
  const group = resizeArea(darkness, canvasW, canvasH, width, height);
  const crop = cropDarknessToInk(darkness, canvasW, canvasH);
  const shape = resizeArea(crop.data, crop.width, crop.height, width, height);
  const rows = new Float32Array(height);
  const columns = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) {
      const v = group[y * width + x];
      sum += v;
      columns[x] += v / height;
    }
    rows[y] = sum / width;
  }
  return { group, shape, rows, columns };
}

function mse(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Number(a[i]) - Number(b[i]);
    sum += d * d;
  }
  return sum / a.length;
}

function makeShiftedFloatImages(test: Float32Array, width: number, height: number, tolerance: number): Float32Array[] {
  const shifts: Float32Array[] = [];
  for (let dy = -tolerance; dy <= tolerance; dy++) {
    for (let dx = -tolerance; dx <= tolerance; dx++) {
      const shifted = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= height) continue;
        const dstRow = y * width;
        const srcRow = sy * width;
        for (let x = 0; x < width; x++) {
          const sx = x - dx;
          if (sx >= 0 && sx < width) shifted[dstRow + x] = test[srcRow + sx];
        }
      }
      shifts.push(shifted);
    }
  }
  return shifts;
}

function makeBitset(values: Float32Array, threshold: number): Uint32Array {
  const words = new Uint32Array(Math.ceil(values.length / 32));
  for (let i = 0; i < values.length; i++) {
    if (values[i] >= threshold) words[i >>> 5] |= 1 << (i & 31);
  }
  return words;
}

function popcount32(value: number): number {
  value >>>= 0;
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function shiftedFloatMse(shifts: Float32Array[], train: Float32Array): number {
  let best = Number.POSITIVE_INFINITY;
  const n = train.length;
  for (const shifted of shifts) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = shifted[i] - train[i];
      sum += d * d;
    }
    const value = sum / n;
    if (value < best) best = value;
  }
  return best;
}

function shiftedBinaryMseBitset(shiftBits: Uint32Array[], train: Uint32Array, pixelCount: number): number {
  let bestMismatch = Number.POSITIVE_INFINITY;
  for (const shifted of shiftBits) {
    let mismatch = 0;
    for (let i = 0; i < train.length; i++) mismatch += popcount32(shifted[i] ^ train[i]);
    if (mismatch < bestMismatch) bestMismatch = mismatch;
  }
  return bestMismatch / pixelCount;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export class TimeCardRecognizer {
  private readonly labels: string[];
  private readonly labelToIndex = new Map<string, number>();
  private readonly featureW: number;
  private readonly featureH: number;
  private readonly canvasW: number;
  private readonly canvasH: number;
  private readonly targetTop: number;
  private readonly targetBottom: number;
  private readonly safeMargin: number;
  private readonly binaryThreshold: number;
  private readonly tolerance: number;
  private readonly templatesPerLabel: number;
  private readonly reviewThreshold: number;
  private readonly weights: RecognizerModelJson["classifier"]["distance_weights"];
  private readonly allowed: number[][];
  private readonly templates: PreparedTemplate[];
  private readonly templatesByLabel: PreparedTemplate[][];
  private readonly validTimes: string[] = [];
  private readonly validIndices: number[][] = [];

  constructor(
    private readonly model: RecognizerModelJson,
    private readonly hybridRule: HybridNormalizerRule,
  ) {
    if (model.schema !== "timecard-integrated-template-feature-model-v1") throw new Error("Unsupported model schema");
    if (hybridRule.schema !== "timecard-hybrid-normalizer-trigger-v1") throw new Error("Unsupported hybrid rule schema");
    this.labels = model.labels;
    this.labels.forEach((label, index) => this.labelToIndex.set(label, index));
    [this.canvasW, this.canvasH] = model.normalisation.canvas;
    [this.featureW, this.featureH] = model.normalisation.feature_pixels;
    [this.targetTop, this.targetBottom] = model.normalisation.target_digit_band_y;
    this.safeMargin = model.normalisation.safe_margin;
    this.binaryThreshold = model.normalisation.binary_threshold;
    this.tolerance = model.classifier.pixel_shift_tolerance;
    this.templatesPerLabel = model.classifier.templates_per_label;
    this.reviewThreshold = model.classifier.review_policy.review_when_score_gte;
    this.weights = model.classifier.distance_weights;
    this.allowed = Array.from({ length: 5 }, (_, position) =>
      model.classifier.position_constraints[String(position)].map((label) => this.indexOfLabel(label)),
    );
    this.templates = model.templates.map((item) => {
      const group = Float32Array.from(item.group_pixels_u8, (v) => v / 255);
      const shape = Float32Array.from(item.shape_pixels_u8, (v) => v / 255);
      return {
        sampleId: item.sample_id,
        labelIndex: this.indexOfLabel(item.label),
        group,
        shape,
        rows: Float32Array.from(item.row_projection),
        columns: Float32Array.from(item.column_projection),
        groupBinary: makeBitset(group, this.binaryThreshold),
        shapeBinary: makeBitset(shape, this.binaryThreshold),
      };
    });
    this.templatesByLabel = Array.from({ length: this.labels.length }, () => [] as PreparedTemplate[]);
    this.templates.forEach((t) => this.templatesByLabel[t.labelIndex].push(t));
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        this.validTimes.push(time);
        this.validIndices.push(Array.from(time, (c) => this.indexOfLabel(c)));
      }
    }
  }

  private indexOfLabel(label: string): number {
    const index = this.labelToIndex.get(label);
    if (index === undefined) throw new Error(`Unknown label: ${label}`);
    return index;
  }

  private analyzeGroup(glyphs: GrayImage[], boxes: GlyphBox[]): {
    items: AnalyzedGlyph[];
    originalGeometry: Geometry;
    edgeGeometry: Geometry;
    maxEdgeSpan: number;
  } {
    if (glyphs.length !== 5 || boxes.length !== 5) throw new Error("Exactly five glyphs and five boxes are required");
    let maxEdgeSpan = 0;
    const items = glyphs.map((glyph, charIndex) => {
      const originalInk = analyzeInk(glyph);
      maxEdgeSpan = Math.max(
        maxEdgeSpan,
        edgeHorizontalSpanRatio(originalInk, true, EDGE_TRIM_PX),
        edgeHorizontalSpanRatio(originalInk, false, EDGE_TRIM_PX),
      );
      const edgeImage = cropGrayVertical(glyph, EDGE_TRIM_PX);
      const edgeInk = analyzeInk(edgeImage);
      return {
        charIndex,
        original: { ...originalInk, box: { ...boxes[charIndex] } },
        edge: {
          ...edgeInk,
          box: {
            x1: boxes[charIndex].x1,
            y1: boxes[charIndex].y1 + EDGE_TRIM_PX,
            x2: boxes[charIndex].x2,
            y2: boxes[charIndex].y2 - EDGE_TRIM_PX,
          },
        },
      };
    });
    return {
      items,
      originalGeometry: geometry(items, "original", this.canvasW, this.canvasH, this.targetTop, this.targetBottom, this.safeMargin),
      edgeGeometry: geometry(items, "edge", this.canvasW, this.canvasH, this.targetTop, this.targetBottom, this.safeMargin),
      maxEdgeSpan,
    };
  }

  private recognizeNormalized(darkness: Float32Array[]): RecognitionResult {
    const featureRows = darkness.map((d) => makeFeatures(d, this.canvasW, this.canvasH, this.featureW, this.featureH));
    const scores = Array.from({ length: 5 }, () => new Float64Array(this.labels.length).fill(Number.POSITIVE_INFINITY));
    const nearest: string[][][] = Array.from({ length: 5 }, () => Array.from({ length: this.labels.length }, () => [] as string[]));

    for (let position = 0; position < 5; position++) {
      // HH:MM fixes position 2 to ':'. It still participates in normalization geometry,
      // but classification of the colon is unnecessary for time decoding/review.
      if (position === 2) {
        const colonIndex = this.indexOfLabel(":");
        scores[position][colonIndex] = 0;
        continue;
      }
      const f = featureRows[position];
      const groupShifts = makeShiftedFloatImages(f.group, this.featureW, this.featureH, this.tolerance);
      const shapeShifts = makeShiftedFloatImages(f.shape, this.featureW, this.featureH, this.tolerance);
      const groupBitShifts = groupShifts.map((v) => makeBitset(v, this.binaryThreshold));
      const shapeBitShifts = shapeShifts.map((v) => makeBitset(v, this.binaryThreshold));
      for (let labelIndex = 0; labelIndex < this.labels.length; labelIndex++) {
        const distances: { value: number; id: string }[] = [];
        for (const t of this.templatesByLabel[labelIndex]) {
          const distance =
            this.weights.group_shifted_pixels * shiftedFloatMse(groupShifts, t.group) +
            this.weights.group_shifted_binary * shiftedBinaryMseBitset(groupBitShifts, t.groupBinary, this.featureW * this.featureH) +
            this.weights.row_and_column_projections * (mse(f.rows, t.rows) + mse(f.columns, t.columns)) +
            this.weights.shape_shifted_pixels * shiftedFloatMse(shapeShifts, t.shape) +
            this.weights.shape_shifted_binary * shiftedBinaryMseBitset(shapeBitShifts, t.shapeBinary, this.featureW * this.featureH);
          distances.push({ value: distance, id: t.sampleId });
        }
        distances.sort((a, b) => a.value - b.value);
        const selected = distances.slice(0, Math.min(this.templatesPerLabel, distances.length));
        scores[position][labelIndex] = selected.reduce((s, v) => s + v.value, 0) / selected.length;
        nearest[position][labelIndex] = selected.map((v) => v.id);
      }
    }

    const normalized = Array.from({ length: 5 }, () => new Float64Array(this.labels.length));
    for (const position of [0, 1, 3, 4]) {
      const values = Array.from(scores[position]);
      const best = Math.min(...values);
      let denominator = median(values) - best;
      if (denominator <= 1e-8) denominator = Math.max(...values) - best;
      denominator = Math.max(denominator, 1e-8);
      for (let i = 0; i < this.labels.length; i++) normalized[position][i] = (scores[position][i] - best) / denominator;
    }

    const candidateScores = new Float64Array(this.validTimes.length);
    for (let c = 0; c < this.validTimes.length; c++) {
      let total = 0;
      for (const position of [0, 1, 3, 4]) total += normalized[position][this.validIndices[c][position]];
      candidateScores[c] = total;
    }
    const order = Array.from({ length: candidateScores.length }, (_, i) => i).sort((a, b) => candidateScores[a] - candidateScores[b]);
    const time = this.validTimes[order[0]];
    const reviewScore = Math.max(...[0, 1, 3, 4].map((position) => Math.min(...Array.from(scores[position]))));

    const characters: CharacterRecognition[] = Array.from(time).map((predicted, position) => {
      const labelIndex = this.indexOfLabel(predicted);
      const allowedScores = this.allowed[position].map((index) => scores[position][index]).sort((a, b) => a - b);
      const relativeMargin = allowedScores.length > 1 ? (allowedScores[1] - allowedScores[0]) / (allowedScores[1] + 1e-8) : 1;
      return {
        position,
        predicted,
        score: roundTo(scores[position][labelIndex], 8),
        relative_margin: roundTo(relativeMargin, 6),
        nearest_samples: nearest[position][labelIndex],
      };
    });

    return {
      time,
      review_required: reviewScore >= this.reviewThreshold,
      review_score: roundTo(reviewScore, 8),
      review_threshold: this.reviewThreshold,
      candidate_margin: roundTo(candidateScores[order[1]] - candidateScores[order[0]], 6),
      characters,
      scope: "recognition after a correct five-character crop",
    };
  }

  /**
   * Recognize one already-cut HH:MM stamp. glyphs must be ordered H,H,:,M,M.
   * boxes must be the original source coordinates for those five glyph crops.
   */
  recognize(glyphs: GrayImage[], boxes: GlyphBox[]): HybridRecognitionResult {
    const analyzed = this.analyzeGroup(glyphs, boxes);
    const scaleGain = analyzed.edgeGeometry.scale / analyzed.originalGeometry.scale - 1;
    const primaryCfg = this.hybridRule.primary_route.use_edge_when;
    const primary: "original" | "edge" =
      scaleGain >= primaryCfg.scale_gain_gte && analyzed.maxEdgeSpan >= primaryCfg.max_edge_horizontal_span_ratio_gte
        ? "edge"
        : "original";
    const alternate: "original" | "edge" = primary === "edge" ? "original" : "edge";

    const primaryGeometry = primary === "edge" ? analyzed.edgeGeometry : analyzed.originalGeometry;
    const primaryResult = this.recognizeNormalized(
      renderNormalized(analyzed.items, primaryGeometry, primary, this.canvasW, this.canvasH, this.safeMargin),
    );

    const dualCfg = this.hybridRule.dual_route_escalation.run_alternate_when_all;
    const dualRoute =
      primaryResult.review_score >= dualCfg.primary_review_score_gte &&
      scaleGain >= dualCfg.scale_gain_gte &&
      analyzed.maxEdgeSpan >= dualCfg.max_edge_horizontal_span_ratio_gte;

    let chosen = primary;
    let result = primaryResult;
    if (dualRoute) {
      const alternateGeometry = alternate === "edge" ? analyzed.edgeGeometry : analyzed.originalGeometry;
      const alternateResult = this.recognizeNormalized(
        renderNormalized(analyzed.items, alternateGeometry, alternate, this.canvasW, this.canvasH, this.safeMargin),
      );
      if (alternateResult.review_score < primaryResult.review_score) {
        chosen = alternate;
        result = alternateResult;
      }
    }

    return {
      ...result,
      hybrid: {
        primary,
        chosen,
        dual_route: dualRoute,
        scale_gain: scaleGain,
        max_edge_horizontal_span_ratio: analyzed.maxEdgeSpan,
      },
    };
  }
}

/** Convert browser ImageData into grayscale for this recognizer. */
export function grayImageFromImageData(imageData: ImageData): GrayImage {
  const out = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // BT.601 luminance. For grayscale time-card images R/G/B are normally equal.
    out[i] = Math.round(0.299 * imageData.data[p] + 0.587 * imageData.data[p + 1] + 0.114 * imageData.data[p + 2]);
  }
  return { width: imageData.width, height: imageData.height, data: out };
}

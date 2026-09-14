import type { OpenCv, OpenCvModule } from './opencvTypes'

function openCvUrl():string{
  if(import.meta.env.PROD)return new URL('../vendor/opencv/opencv.js',self.location.href).href
  return new URL('vendor/opencv/opencv.js',new URL(import.meta.env.BASE_URL,self.location.origin+'/')).href
}
const READY_TIMEOUT_MS = 60_000
let loadPromise: Promise<OpenCv> | undefined

function assertWorkerOpenCv(value: OpenCvModule): OpenCv {
  if (typeof value.Mat !== 'function' || typeof value.getBuildInformation !== 'function') throw new Error('OpenCV.js worker runtime is unusable')
  value.getBuildInformation()
  const source = new value.Mat(1, 1, value.CV_8UC1), resized = new value.Mat(), warped = new value.Mat(), matrix = value.matFromArray(3, 3, value.CV_64F, [1,0,0,0,1,0,0,0,1])
  try {
    value.resize(source, resized, new value.Size(1, 1), 0, 0, value.INTER_LINEAR)
    value.warpPerspective(source, warped, matrix, new value.Size(1, 1), value.INTER_LINEAR, value.BORDER_CONSTANT, new value.Scalar(255))
  } finally { source.delete(); resized.delete(); warped.delete(); matrix.delete() }
  if (!(value instanceof Promise) && typeof value.then === 'function') Object.defineProperty(value, 'then', { configurable: true, value: undefined, writable: true })
  return value
}

async function initialize(): Promise<OpenCv> {
  const scope = self as typeof self & { cv?: OpenCvModule; Module?: { onRuntimeInitialized?: () => void }; importScripts?: (...urls: string[]) => void }
  let ready!: () => void
  const completion = new Promise<void>((resolve) => { ready = resolve })
  scope.Module = { ...scope.Module, onRuntimeInitialized: ready }
  let loadedByImportScripts=false
  if (typeof scope.importScripts === 'function') {
    try { scope.importScripts(openCvUrl()); loadedByImportScripts=true }
    catch (error) { if (!String(error).includes('Module scripts')) throw error }
  }
  if (!loadedByImportScripts) {
    if (import.meta.env.PROD) throw new Error('OpenCV.js classic-worker loading is unavailable')
    // Vite serves bundled workers as modules in development. Execute only the
    // same-origin, checked-in OpenCV UMD asset in the worker global scope.
    // This development-only branch is removed from the production bundle.
    const source = await fetch(openCvUrl(), { credentials: 'same-origin' }).then((response) => {
      if (!response.ok) throw new Error(`OpenCV.js worker asset failed: ${response.status}`)
      return response.text()
    })
    ;(0, eval)(source)
  }
  const exposed = scope.cv
  if (!exposed) throw new Error('OpenCV.js did not expose self.cv')
  if (typeof exposed.Mat !== 'function') {
    const signal = typeof exposed.then === 'function' ? new Promise<void>((resolve) => { exposed.then?.(() => resolve()) }) : completion
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([signal, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('OpenCV.js worker initialization timed out')), READY_TIMEOUT_MS) })]) }
    finally { if (timer !== undefined) clearTimeout(timer) }
  }
  // Never resolve/await the self-referential thenable itself.
  return assertWorkerOpenCv(exposed)
}

export function loadOpenCvInWorker(): Promise<OpenCv> { return loadPromise ??= initialize() }

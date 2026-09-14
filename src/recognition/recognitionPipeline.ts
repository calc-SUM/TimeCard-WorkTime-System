import { cropMachineStamps } from './cropRoutes'
import { evaluatePresenceCard } from './presence'
import { assembleCellRecognition, recognizeCropRoute, type RecognizerLike } from './recognizerAdapter'
import { registerTimeCard } from './registration'
import { traceRowGeometry } from './rowGeometry'
import type { OpenCv } from './opencvTypes'
import type { GrayImage } from './recognitionTypes'
import type { RecognitionProgressStage, WorkerPhotoResult } from './workerProtocol'

export type PipelineResult = { ok: true; result: WorkerPhotoResult } | { ok: false; reason: string }

export function processRecognitionPhoto(cv: OpenCv, recognizer: RecognizerLike, raw: GrayImage, progress: (stage: RecognitionProgressStage) => void = () => {}): PipelineResult {
  const totalStart=performance.now(),geometryStart=performance.now();progress('registration');const registration=registerTimeCard(cv,raw)
  if(!registration.ok)return{ok:false,reason:registration.reason}
  if(!registration.qa.passed)return{ok:false,reason:'registration_qa'}
  const rows=traceRowGeometry(cv,registration.rectified),h44H17Ms=performance.now()-geometryStart
  progress('presence');const presenceCropStart=performance.now(),presence=evaluatePresenceCard(cv,registration.rectified,rows);progress('cropping');const crops=cropMachineStamps(cv,raw,registration.homography,registration.rectified,rows,presence.cells),presenceCropMs=performance.now()-presenceCropStart
  progress('recognition');const recognizerStart=performance.now(),machine=new Map(crops.cells.map(cell=>{const routes={H75:recognizeCropRoute(recognizer,cell.routes.H75),H76:recognizeCropRoute(recognizer,cell.routes.H76),H78:recognizeCropRoute(recognizer,cell.routes.H78)},assembled=assembleCellRecognition(cell.selectedRoute,routes),compactRoutes={H75:{prediction:routes.H75.prediction,reviewRequired:routes.H75.reviewRequired,failure:routes.H75.failure},H76:{prediction:routes.H76.prediction,reviewRequired:routes.H76.reviewRequired,failure:routes.H76.failure},H78:{prediction:routes.H78.prediction,reviewRequired:routes.H78.reviewRequired,failure:routes.H78.failure}};return[`${cell.row}:${cell.column}`,{...assembled,routes:compactRoutes}]})),recognizerMs=performance.now()-recognizerStart
  const cells=presence.cells.map(cell=>{const recognized=machine.get(`${cell.row}:${cell.column}`);if(cell.classification==='suspicious_content')return{row:cell.row,column:cell.column,classification:cell.classification,issueType:'suspicious_content' as const};if(cell.classification==='blank')return{row:cell.row,column:cell.column,classification:cell.classification};return{row:cell.row,column:cell.column,classification:cell.classification,...recognized,time:recognized?.prediction}})
  progress('completed');return{ok:true,result:{cells,qa:registration.qa,routeCounts:{H75:crops.cells.filter(cell=>cell.selectedRoute==='H75').length,H76:crops.cells.filter(cell=>cell.selectedRoute==='H76').length,H78:crops.cells.filter(cell=>cell.selectedRoute==='H78').length},timing:{h44H17Ms,presenceCropMs,recognizerMs,totalMs:performance.now()-totalStart}}}
}

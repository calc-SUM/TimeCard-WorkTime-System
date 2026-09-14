import type { CardUiState, TimeCellUiState, WorkRowUiState } from '../fixtures/developmentFixture'
import type { WorkerCellResult, WorkerPhotoResult } from './workerProtocol'

function emptyCell():TimeCellUiState{return{value:'',originalRecognizedValue:'',reviewRequired:false,reviewAcknowledged:false,userModified:false}}
function mapCell(cell:WorkerCellResult|undefined):TimeCellUiState{
  if(!cell||cell.classification==='blank')return emptyCell()
  if(cell.classification==='suspicious_content')return{...emptyCell(),reviewRequired:true,recognitionIssue:'suspicious_content'}
  if(!cell.time)return{...emptyCell(),reviewRequired:true,recognitionIssue:'recognition_failed'}
  return{value:cell.time,originalRecognizedValue:cell.time,reviewRequired:cell.finalReview===true,reviewAcknowledged:false,userModified:false,recognitionReviewReasons:{recognizer:cell.recognizerReview===true,routeDisagreement:cell.routePredictionDisagreement===true,cropFailure:cell.cropFailureReview===true}}
}

export function recognitionResultToCard(photoId:string,fileName:string,result:WorkerPhotoResult):CardUiState{
  const byPosition=new Map(result.cells.map(cell=>[`${cell.row}:${cell.column}`,cell]))
  const rows:WorkRowUiState[]=Array.from({length:31},(_,row)=>({rowId:`recognized-${row}`,sourceRowIndex:row,manuallyInserted:false,cells:[1,2,3,4].map(column=>mapCell(byPosition.get(`${row}:${column}`))) as WorkRowUiState['cells']}))
  return{id:`card-${photoId}`,photoId,fileName,rows,exceptionMinutes:0,exceptionInvalidInput:null}
}

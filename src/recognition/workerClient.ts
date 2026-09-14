import type { RecognitionProgressStage, RecognitionWorkerRequest, RecognitionWorkerResponse, WorkerInitializedResponse, WorkerPhotoResult } from './workerProtocol'
import RecognitionWorker from './recognitionWorker?worker'

type WorkerFactory=()=>Worker
type WorkerRequestPayload={type:'initialize'}|{type:'processPhoto';bytes:ArrayBuffer;mimeType:string}|{type:'dispose'}
export class RecognitionWorkerCrashedError extends Error {}
export class RecognitionWorkerClient{
  private worker:Worker|undefined
  private sequence=0
  private pending=new Map<string,{resolve:(value:RecognitionWorkerResponse)=>void;reject:(reason:unknown)=>void;progress?:(stage:RecognitionProgressStage)=>void}>()
  constructor(private readonly factory:WorkerFactory=()=>new RecognitionWorker()){ }
  private ensure(){if(!this.worker){this.worker=this.factory();this.worker.onmessage=(event:MessageEvent<RecognitionWorkerResponse>)=>{const response=event.data,pending=this.pending.get(response.requestId);if(!pending)return;if(response.type==='progress'){pending.progress?.(response.stage);return}this.pending.delete(response.requestId);response.type==='failed'?pending.reject(new Error(response.reason)):pending.resolve(response)};this.worker.onerror=(event)=>{for(const pending of this.pending.values())pending.reject(new RecognitionWorkerCrashedError(event.message));this.pending.clear();this.worker?.terminate();this.worker=undefined}}return this.worker}
  private request(message:WorkerRequestPayload,transfer:Transferable[]=[],progress?:(stage:RecognitionProgressStage)=>void){const requestId=String(++this.sequence),worker=this.ensure();return new Promise<RecognitionWorkerResponse>((resolve,reject)=>{this.pending.set(requestId,{resolve,reject,progress});worker.postMessage({...message,requestId} as RecognitionWorkerRequest,transfer)})}
  async initialize():Promise<WorkerInitializedResponse>{const response=await this.request({type:'initialize'});if(response.type!=='initialized')throw Error(`Unexpected response ${response.type}`);return response}
  async processPhoto(blob:Blob,progress?:(stage:RecognitionProgressStage)=>void):Promise<WorkerPhotoResult>{const bytes=await blob.arrayBuffer(),response=await this.request({type:'processPhoto',bytes,mimeType:blob.type},[bytes],progress);if(response.type!=='completed')throw Error(`Unexpected response ${response.type}`);return response.result}
  async dispose():Promise<void>{if(!this.worker)return;try{await this.request({type:'dispose'})}finally{this.worker.terminate();this.worker=undefined;this.pending.clear()}}
}

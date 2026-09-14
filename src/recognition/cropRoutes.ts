import { mean, percentile, std } from './imageProcessing'
import type { CvMat, OpenCv } from './opencvTypes'
import type { GrayImage, LineModel, RowBoundaryModel } from './recognitionTypes'
import type { PresenceCellResult } from './presence'
import { selectCropRoute, structureCost, structureCostComponents, type CropRouteName, type CropRouteResult, type GlyphBox } from './routeSelector'

interface MachineCell { row: number; column: 1 | 2 | 3 | 4 }
interface ComponentShape { area: number; width: number; height: number; centerY: number }
interface ColonScoreDetails { offset:number; total:number; centerShape:number; density:number; activeRows:number; componentCount:number; components:ComponentShape[]; left:number; right:number; quietLeft:number; quietRight:number; sideEvidence:number; sideImbalancePenalty:number; quietPenalty:number; twoLobe:number; sparsePenalty:number }
interface RouteRecord {
  cell: MachineCell
  colonX: number
  rawCell: GrayImage
  y1: number
  y2: number
  projection: Float32Array
}
export interface CropRouteDiagnostics {
  h75: { globalPath: Record<number, number>; columnPath: Record<number, Record<number, number>>; calibration: number[]; baseBounds: Array<number[] | undefined> }
  h76: { globalPath: Record<number, number>; columnPath: Record<number, Record<number, number>>; calibration: number[]; baseBounds: Array<number[] | undefined> }
  h78: { globalCommonBounds: number[]; commonBounds: number[][] }
}
export interface CropCellResult {
  row: number
  column: 1 | 2 | 3 | 4
  selectedRoute: CropRouteName
  selected: CropRouteResult
  routes: { H75: CropRouteResult; H76: CropRouteResult; H78: CropRouteResult }
}
export interface CropTiming { commonPreprocessingMs: number; h75Ms: number; h76Ms: number; h78ProfileMs: number; h78CellsMs: number; selectorMs: number; totalMs: number }
export interface CropCardResult { cells: CropCellResult[]; timing: CropTiming; diagnostics?: CropRouteDiagnostics }
export interface H72CellDiagnostics { cell:MachineCell; geometry:{centerX:number;top:number;bottom:number;crop:{x:number;y:number;width:number;height:number}}; preResize:{width:number;height:number;data:Uint8Array;min:number;max:number;mean:number;p5:number;p90:number;hash:string}; resized:{width:number;height:number;data:Uint8Array;min:number;max:number;mean:number;p5:number;p90:number;hash:string}; normalized:{width:number;height:number;data:Float32Array;min:number;max:number;mean:number;p5:number;p90:number;denominator:number;hash:string}; rawCell:{width:number;height:number;min:number;max:number;mean:number;p5:number;p90:number;hash:string}; baseScores:ColonScoreDetails[]; enhancedScores:ColonScoreDetails[] }
export interface RawWarpDiagnostics { qH44F32:number[]; inverseH:number[]; rawSourceF64:number[]; rawSourceF32:number[]; rawMatrix:number[]; destination:number[]; rawCell:GrayImage; localMatrix:number[]; localCell:GrayImage; h22:[number,number]; band:GrayImage; darkness:{p90:number;p4:number;denominator:number;data:Float32Array}; strong36Mask:Uint8Array; projection:Float32Array }

const WIDTH = 94
const HEIGHT = 32
const RELATIVE_BANDS = [[-76, -48], [-50, -20], [-18, -2], [2, 18], [20, 50], [50, 82]] as const

/** Python 3 round(x): nearest integer, with exact .5 ties going to even. */
export function pythonRound(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction < 0.5) return floor
  if (fraction > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}
/** NumPy compares a float32 array against a scalar cast to the array dtype. */
export function pythonFloat32GreaterThan(value:number,threshold:number):boolean{return value>Math.fround(threshold)}

function darkness(image: GrayImage): Float32Array {
  const source = Float32Array.from(image.data)
  const background = percentile(source, 90)
  const low = percentile(source, 4)
  const scale = 220 / Math.max(background - low, 28)
  return Float32Array.from(source, (value) => Math.max(0, Math.min(255, (background - value) * scale)))
}

function lineY(line: LineModel, x: number): number { return line.slope * x + line.intercept }

function invert3x3(m: number[]): number[] {
  const [a,b,c,d,e,f,g,h,i] = m
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d
  const determinant=a*A+b*D+c*G
  return [A,B,C,D,E,F,G,H,I].map((value) => value / determinant)
}

function transformPoint(m: number[], x: number, y: number): [number, number] {
  const denominator = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / denominator, (m[3] * x + m[4] * y + m[5]) / denominator]
}

function warpQuad(cv: OpenCv, source: CvMat, points: number[], width: number, height: number): GrayImage {
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, points)
  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
  let transform: CvMat | undefined
  let output: CvMat | undefined
  try {
    transform = cv.getPerspectiveTransform(src, dst)
    output = new cv.Mat()
    cv.warpPerspective(source, output, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255))
    return { width, height, data: new Uint8Array(output.data) }
  } finally { src.delete(); dst.delete(); transform?.delete(); output?.delete() }
}

function resizePatch(cv: OpenCv, source: CvMat, x: number, y: number, width: number, height: number): GrayImage | undefined {
  if (width <= 0 || height <= 0) return undefined
  let roi: CvMat | undefined
  let output: CvMat | undefined
  try {
    roi = source.roi({ x, y, width, height })
    output = new cv.Mat()
    cv.resize(roi, output, new cv.Size(94, 24), 0, 0, cv.INTER_LINEAR)
    return { width: 94, height: 24, data: new Uint8Array(output.data) }
  } finally { roi?.delete(); output?.delete() }
}

function normalizedPatch(image: GrayImage): Float32Array {
  const values = Float32Array.from(image.data)
  const background = percentile(values, 90)
  const low = percentile(values, 5)
  const divisor = Math.max(background - low, 20)
  return Float32Array.from(values, (value) => Math.max(0, Math.min(1, (background - value) / divisor)))
}

function numericSummary(values:ArrayLike<number>){const data=Array.from(values),hash=data.reduce((h,value)=>Math.imul(h^Math.round(value*1e6),16777619)>>>0,2166136261);return{min:Math.min(...data),max:Math.max(...data),mean:mean(data),p5:percentile(data,5),p90:percentile(data,90),hash:hash.toString(16).padStart(8,'0')}}

function componentShapes(cv:OpenCv,mask:Uint8Array,width:number,height:number):ComponentShape[]{
  const source=new cv.Mat(height,width,cv.CV_8UC1),labels=new cv.Mat(),stats=new cv.Mat(),centroids=new cv.Mat()
  try{source.data.set(mask);const count=cv.connectedComponentsWithStats(source,labels,stats,centroids,8,cv.CV_32S),output:ComponentShape[]=[];for(let label=1;label<count;label++)output.push({width:stats.data32S[label*5+2],height:stats.data32S[label*5+3],area:stats.data32S[label*5+4],centerY:centroids.data64F[label*2+1]});return output}finally{source.delete();labels.delete();stats.delete();centroids.delete()}
}

function colonScoreDetails(cv:OpenCv,patch:Float32Array,x:number,enhanced:boolean):ColonScoreDetails {
  const x1=Math.max(0,x-4),x2=Math.min(94,x+5),w=x2-x1
  if(w<7)return{offset:x,total:-1e6,centerShape:-1e6,density:1,activeRows:0,componentCount:0,components:[],left:NaN,right:NaN,quietLeft:NaN,quietRight:NaN,sideEvidence:0,sideImbalancePenalty:0,quietPenalty:0,twoLobe:0,sparsePenalty:0}
  const mask=new Uint8Array(24*w),vertical=new Float64Array(24);let total=0,active=0
  for(let y=0;y<24;y++){for(let xx=x1;xx<x2;xx++){const ink=pythonFloat32GreaterThan(patch[y*94+xx],.30)?1:0;mask[y*w+xx-x1]=ink;vertical[y]+=ink;total+=ink}if(vertical[y]>0)active++}
  const allComponents=componentShapes(cv,mask,w,24),components=allComponents.filter(component=>component.area>=2),density=total/(24*w)
  const top=(vertical[0]+vertical[1]+vertical[2])/3,bottom=(vertical[21]+vertical[22]+vertical[23])/3
  const centerShape=-5*Math.abs(density-.22)-.10*Math.abs(active-14)-.35*Math.abs(components.length-2)-.16*((top+bottom)/2)
  const densityBand=(a:number,b:number,threshold:number)=>{const lo=Math.max(0,a),hi=Math.min(94,b);if(hi<=lo)return NaN;let ink=0;for(let y=0;y<24;y++)for(let xx=lo;xx<hi;xx++)if(pythonFloat32GreaterThan(patch[y*94+xx],threshold))ink++;return ink/(24*(hi-lo))}
  const left=densityBand(x-32,x-6,.25),right=densityBand(x+6,x+38,.25)
  if(!Number.isFinite(left)||!Number.isFinite(right))return{offset:x,total:-1e6,centerShape,density,activeRows:active,componentCount:components.length,components:allComponents,left,right,quietLeft:NaN,quietRight:NaN,sideEvidence:0,sideImbalancePenalty:0,quietPenalty:0,twoLobe:0,sparsePenalty:0}
  const ql=densityBand(x-7,x-4,.3),qr=densityBand(x+4,x+7,.3)
  const sideEvidence=2.8*Math.min(left,right),sideImbalancePenalty=1.2*Math.abs(left-right),quietPenalty=.7*(ql+qr),twoLobe=enhanced?twoLobeScoreFromComponents(allComponents):0,sparsePenalty=enhanced?3*Math.max(0,density-.20):0
  return{offset:x,total:centerShape+sideEvidence-sideImbalancePenalty-quietPenalty+(enhanced?1.8*twoLobe-sparsePenalty:0),centerShape,density,activeRows:active,componentCount:components.length,components:allComponents,left,right,quietLeft:ql,quietRight:qr,sideEvidence,sideImbalancePenalty,quietPenalty,twoLobe,sparsePenalty}
}

export function twoLobeScoreFromComponents(components:ComponentShape[]):number {
  const sorted=[...components].filter(c=>c.area>=2).sort((a,b)=>a.centerY-b.centerY)
  let best=0
  for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){
    const a=sorted[i],b=sorted[j],separation=b.centerY-a.centerY
    if(separation<4||separation>18)continue
    const compact=Math.max(0,1-(Math.max(a.height,b.height)-5)/8),balance=Math.min(a.area,b.area)/Math.max(a.area,b.area),quality=Math.max(0,1-Math.abs(separation-10)/12)
    best=Math.max(best,compact*balance*quality)
  }
  return best
}

export function twoLobeColonScore(cv:OpenCv,patch: Float32Array, x: number): { score: number; density: number } {
  const x1=Math.max(0,x-4),x2=Math.min(94,x+5),w=x2-x1
  if(w<7)return{score:0,density:1}
  const mask=new Uint8Array(24*w);let total=0
  for(let y=0;y<24;y++)for(let xx=x1;xx<x2;xx++){const ink=pythonFloat32GreaterThan(patch[y*94+xx],.30)?1:0;mask[y*w+xx-x1]=ink;total+=ink}
  return{score:twoLobeScoreFromComponents(componentShapes(cv,mask,w,24)),density:total/(24*w)}
}

function colonScore(cv:OpenCv,patch: Float32Array,x:number,enhanced:boolean){return colonScoreDetails(cv,patch,x,enhanced).total}

export function argmax(values: ArrayLike<number>): number { let best=0;for(let i=1;i<values.length;i++)if(values[i]>values[best])best=i;return best }

function pathsAsRecords(path: Map<number, number>, columns?: Map<number, Map<number, number>>) {
  const globalPath = Object.fromEntries(path)
  const columnPath = Object.fromEntries([...(columns ?? new Map())].map(([column, values]) => [column, Object.fromEntries(values)]))
  return { globalPath, columnPath }
}

function colonPaths(cv:OpenCv,patches: Map<string,Float32Array>,cells:MachineCell[],enhanced:boolean):{ cells: Map<string,number>; global: Map<number,number>; columns: Map<number,Map<number,number>> }{
  const offsets=Array.from({length:54},(_,i)=>i+16),byRow=new Map<number,number[]>()
  for(const cell of cells)byRow.set(cell.row,[...(byRow.get(cell.row)??[]),cell.column])
  const scoreTable=new Map<string,number[]>()
  for(const cell of cells){const key=`${cell.row}:${cell.column}`;scoreTable.set(key,offsets.map(x=>colonScore(cv,patches.get(key)!,x,enhanced)))}
  const rows=[...byRow.keys()].sort((a,b)=>a-b),unary=new Map<number,number[]>()
  for(const row of rows)unary.set(row,offsets.map((_,i)=>percentile([...new Set(byRow.get(row)!)].map(c=>scoreTable.get(`${row}:${c}`)![i]),50)))
  let dp=[...unary.get(rows[0])!],backs:number[][]=[]
  for(let k=1;k<rows.length;k++){const gap=Math.max(1,rows[k]-rows[k-1]),next=offsets.map(()=>-1e9),back=offsets.map(()=>0);for(let j=0;j<offsets.length;j++){let bi=0,bv=-Infinity;for(let i=0;i<offsets.length;i++){const d=Math.abs(offsets[i]-offsets[j]),v=dp[i]-.07*d-.025*Math.max(0,d-1.5*gap)**2;if(v>bv){bv=v;bi=i}}next[j]=unary.get(rows[k])![j]+bv;back[j]=bi}backs.push(back);dp=next}
  let cursor=argmax(dp);const global=new Map<number,number>([[rows.at(-1)!,offsets[cursor]]]);for(let k=rows.length-2;k>=0;k--){cursor=backs[k][cursor];global.set(rows[k],offsets[cursor])}
  const result=new Map<string,number>(), columnPaths=new Map<number,Map<number,number>>()
  for(const column of[1,2,3,4]){const columnRows=[...new Set(cells.filter(c=>c.column===column).map(c=>c.row))].sort((a,b)=>a-b);if(!columnRows.length)continue;const scores=new Map(columnRows.map(row=>[row,scoreTable.get(`${row}:${column}`)!]));let d=scores.get(columnRows[0])!.map((v,i)=>v-.05*Math.abs(offsets[i]-global.get(columnRows[0])!)),bs:number[][]=[];for(let k=1;k<columnRows.length;k++){const gap=Math.max(1,columnRows[k]-columnRows[k-1]),next=offsets.map(()=>-1e9),back=offsets.map(()=>0);for(let j=0;j<offsets.length;j++){let bi=0,bv=-Infinity;for(let i=0;i<offsets.length;i++){const diff=Math.abs(offsets[i]-offsets[j]),v=d[i]-.07*diff-.025*Math.max(0,diff-1.5*gap)**2-.05*Math.abs(offsets[j]-global.get(columnRows[k])!);if(v>bv){bv=v;bi=i}}next[j]=scores.get(columnRows[k])![j]+bv;back[j]=bi}bs.push(back);d=next}let ci=argmax(d),perColumn=new Map<number,number>();result.set(`${columnRows.at(-1)}:${column}`,offsets[ci]);perColumn.set(columnRows.at(-1)!,offsets[ci]);for(let k=columnRows.length-2;k>=0;k--){ci=bs[k][ci];result.set(`${columnRows[k]}:${column}`,offsets[ci]);perColumn.set(columnRows[k],offsets[ci])}columnPaths.set(column,perColumn)}
  return { cells: result, global, columns: columnPaths }
}

function h22Band(cell:GrayImage,center=47):[number,number]{const d=darkness(cell),zones=[[center-31,center-18],[center-18,center-5],[center+5,center+18],[center+18,center+34]],good:number[]=[];for(let y=3;y<HEIGHT-3;y++){let n=0;for(const[a,b]of zones){const lo=Math.max(0,a),hi=Math.min(WIDTH,b),row=[];for(let x=lo;x<hi;x++)row.push(d[y*WIDTH+x]);if(hi>lo&&percentile(row,80)>=38)n++}if(n>=2)good.push(y)}if(!good.length)return[4,HEIGHT-4];const med=Math.trunc(percentile(good,50)),local=good.filter(y=>Math.abs(y-med)<=11),use=local.length?local:good;return[Math.max(2,Math.min(...use)-1),Math.min(HEIGHT-2,Math.max(...use)+2)]}

function projection(raw:GrayImage,y1:number,y2:number):Float32Array{const d=darkness({width:raw.width,height:y2-y1,data:raw.data.slice(y1*raw.width,y2*raw.width)}),p=new Float32Array(raw.width);for(let y=0;y<y2-y1;y++)for(let x=0;x<raw.width;x++)if(d[y*raw.width+x]>=36)p[x]++;return p}
export function boundary(p:Float32Array,e:number,r:number){const lo=Math.max(1,pythonRound(e-r)),hi=Math.min(p.length-2,pythonRound(e+r));if(hi<=lo)return undefined;let bx=lo,bv=Infinity;for(let x=lo;x<=hi;x++){let quiet=0;for(let q=Math.max(0,x-1);q<Math.min(p.length,x+2);q++)quiet+=p[q];const v=quiet+.08*Math.abs(x-e);if(v<bv){bv=v;bx=x}}return bx}
function boundaries(p:Float32Array,cx:number,cal?:number[]){const expected=(cal??[-62,-34,-10,10,38,72]).map(x=>x+cx),radii=[12,10,8,8,10,14],b=expected.map((e,i)=>boundary(p,e,radii[i]));if(b.some(x=>x===undefined))return undefined;const out=b as number[];return out.some((x,i)=>i<5&&out[i+1]-x<8)?undefined:out}
function segmentationScore(p:Float32Array,b:number[]|undefined,cx:number){if(!b)return-1e9;let quiet=0;for(const x of b)for(let q=Math.max(0,x-1);q<Math.min(p.length,x+2);q++)quiet+=p[q];const widths=b.slice(1).map((x,i)=>x-b[i]),digitWidths=[widths[0],widths[1],widths[3],widths[4]],ink=b.slice(0,5).map((x,i)=>{let s=0;for(let q=x;q<b[i+1];q++)s+=p[q];return s});if(Math.min(ink[0],ink[1],ink[3],ink[4])<=1)return-1e9;return-.018*quiet-2*std(digitWidths)/Math.max(mean(digitWidths),1)-.08*Math.abs((b[2]+b[3])/2-cx)}

export function quietSeparatorRefine(p:Float32Array,input:number[]):number[]|undefined{const b=[...input];const runs=(a:number,z:number)=>{const out:Array<[number,number]>=[];let i=Math.max(1,a),end=Math.min(p.length-2,z);while(i<=end){if(p[i]<=3){let j=i+1;while(j<=end&&p[j]<=3)j++;if(j-i>=4)out.push([i,j]);i=j}else i++}return out};const left=runs(Math.max(1,b[1]-48),Math.max(1,b[1]-8));if(left.length){const r=left.at(-1)!,candidate=pythonRound((r[0]+r[1]-1)/2);if(b[1]-candidate>=8&&b[1]-candidate<=42)b[0]=candidate}const right=runs(Math.min(p.length-2,b[4]+8),Math.min(p.length-2,b[4]+48));if(right.length){const r=right[0],candidate=pythonRound((r[0]+r[1]-1)/2);if(candidate-b[4]>=8&&candidate-b[4]<=42)b[5]=candidate}return b.some((x,i)=>i<5&&b[i+1]-x<8)?undefined:b}
function trimFirst(raw:GrayImage,y1:number,y2:number,x1:number,x2:number){if(x2-x1<26)return x1;const p=projection({width:x2-x1,height:raw.height,data:Uint8Array.from({length:raw.height*(x2-x1)},(_,i)=>raw.data[Math.floor(i/(x2-x1))*raw.width+x1+i%(x2-x1)])},y1,y2),runs:Array<[number,number]>=[];let i=0;while(i<p.length){if(p[i]<=2){let j=i+1;while(j<p.length&&p[j]<=2)j++;if(j-i>=4)runs.push([i,j]);i=j}else i++}const candidates=runs.filter(r=>r[0]>=8&&r[0]<=14);if(!candidates.length)return x1;candidates.sort((a,b)=>Math.abs((a[0]+a[1]-1)/2-12)-Math.abs((b[0]+b[1]-1)/2-12)||a[0]-b[0]);const[a,b]=candidates[0],cut=pythonRound((a+b-1)/2);return x2-(x1+cut)>=14?x1+cut:x1}
function makeCrop(route:CropRouteName,record:RouteRecord,b:number[]|undefined,failure?:CropRouteResult['failure']):CropRouteResult{if(!b)return{route,failure:failure??'no_boundaries',structureCost:999,colonX:record.colonX,band:[record.y1,record.y2]};const yy1=2*record.y1,yy2=2*record.y2,glyphs:GrayImage[]=[],boxes:GlyphBox[]=[];for(let i=0;i<5;i++){let x1=b[i],x2=b[i+1];if(i===0)x1=trimFirst(record.rawCell,yy1,yy2,x1,x2);if(x2<=x1||yy2<=yy1)return{route,failure:'empty',structureCost:999};const data=new Uint8Array((x2-x1)*(yy2-yy1));let n=0;for(let y=yy1;y<yy2;y++)for(let x=x1;x<x2;x++)data[n++]=record.rawCell.data[y*record.rawCell.width+x];glyphs.push({width:x2-x1,height:yy2-yy1,data});boxes.push({x1,y1:yy1,x2,y2:yy2})}const result:CropRouteResult={route,bounds:b,boxes,glyphs,colonX:record.colonX,band:[record.y1,record.y2],structureCost:0};result.structureComponents=structureCostComponents(result);result.structureCost=structureCost(result);return result}
function localRefine(p:Float32Array,common:number[]){const out=common.map(e=>{const a=Math.max(1,e-5),z=Math.min(p.length-2,e+5);let bx=a,bv=Infinity;for(let x=a;x<=z;x++){let q=0;for(let i=x-1;i<x+2;i++)q+=p[i];const v=q+.45*Math.abs(x-e);if(v<bv){bv=v;bx=x}}return bx});return out.some((x,i)=>i<5&&out[i+1]-x<8)?undefined:out}
export function smooth3(p:Float64Array){const out=new Float64Array(p.length);for(let i=0;i<p.length;i++)out[i]=((i?p[i-1]:0)+p[i]+(i+1<p.length?p[i+1]:0))/3;return out}

export function leaveOneOutMeanProfiles(profiles: readonly Float64Array[]): Float64Array[] {
  if (!profiles.length) return []
  const width = profiles[0].length
  if (profiles.some((profile) => profile.length !== width)) throw new Error('profile widths do not match')
  const total = new Float64Array(width)
  for (const profile of profiles) for (let x = 0; x < width; x += 1) total[x] += profile[x]
  return profiles.map((profile) => Float64Array.from(total, (value, x) => (value - profile[x]) / Math.max(1, profiles.length - 1)))
}

function buildRecords(cv:OpenCv,rectifiedMat:CvMat,rawMat:CvMat,inverseH:number[],geometry:RowBoundaryModel,cells:MachineCell[],enhanced:boolean){const patches=new Map<string,Float32Array>();for(const cell of cells){const center=(cell.column-1)*94+47,top=lineY(geometry.rows[cell.row].top,center),bottom=lineY(geometry.rows[cell.row].bottom,center),y1=Math.max(0,Math.trunc(Math.min(top,bottom))+3),y2=Math.min(950,Math.trunc(Math.max(top,bottom))-3),patch=resizePatch(cv,rectifiedMat,(cell.column-1)*94,y1,94,y2-y1);if(!patch)throw Error('empty row patch');patches.set(`${cell.row}:${cell.column}`,normalizedPatch(patch))}const paths=colonPaths(cv,patches,cells,enhanced),records:RouteRecord[]=[];for(const cell of cells){const cx=paths.cells.get(`${cell.row}:${cell.column}`)!,absolute=(cell.column-1)*94+cx,row=geometry.rows[cell.row],quad=[absolute-47,lineY(row.top,absolute-47),absolute+47,lineY(row.top,absolute+47),absolute+47,lineY(row.bottom,absolute+47),absolute-47,lineY(row.bottom,absolute-47)].map(Math.fround),local=warpQuad(cv,rectifiedMat,quad,94,32),rawPoints:number[]=[];for(let i=0;i<quad.length;i+=2)rawPoints.push(...transformPoint(inverseH,quad[i],quad[i+1]));const rawCell=warpQuad(cv,rawMat,rawPoints,188,64),[y1,y2]=h22Band(local),p=projection(rawCell,2*y1,2*y2);records.push({cell,colonX:cx,rawCell,y1,y2,projection:p})}return { records, paths }}

function h75Or76(records:RouteRecord[],route:CropRouteName){const free=records.map(r=>{const b=boundaries(r.projection,94);return{b,score:segmentationScore(r.projection,b,94)}}),valid=free.filter(x=>x.b).map(x=>x.b!.map(v=>v-94)),cal=valid.length?Array.from({length:6},(_,i)=>percentile(valid.map(v=>v[i]),50)):[-62,-34,-10,10,38,72],baseBounds:Array<number[]|undefined>=[];const routes=records.map((r,i)=>{const calibrated=boundaries(r.projection,94,cal),calScore=segmentationScore(r.projection,calibrated,94),base=calScore>free[i].score?calibrated:free[i].b;baseBounds.push(base);const refined=base&&quietSeparatorRefine(r.projection,base);return makeCrop(route,r,refined,base?'quiet_fail':'no_boundaries')});return{routes,calibration:cal,baseBounds}}

function commonBounds(profile:Float64Array){const smooth=smooth3(profile);return RELATIVE_BANDS.map(([lo,hi])=>{const a=Math.max(1,94+lo),z=Math.min(smooth.length-2,94+hi);let bx=a,bv=Infinity;for(let x=a;x<=z;x++){const v=smooth[x-1]+smooth[x]+smooth[x+1];if(v<bv){bv=v;bx=x}}return bx})}
function h78(records:RouteRecord[],timing:{profile:number;cells:number}){const start=performance.now(),profiles=records.map(r=>{const y1=2*r.y1,y2=2*r.y2,d=darkness({width:r.rawCell.width,height:y2-y1,data:r.rawCell.data.slice(y1*r.rawCell.width,y2*r.rawCell.width)}),out=new Float64Array(r.rawCell.width);for(let x=0;x<r.rawCell.width;x++){let n=0;for(let y=0;y<y2-y1;y++)if(d[y*r.rawCell.width+x]>=36)n++;out[x]=n/(y2-y1)}return out}),globalProfile=Float64Array.from({length:profiles[0]?.length??188},(_,x)=>mean(profiles.map(profile=>profile[x]))),globalCommonBounds=commonBounds(globalProfile),leaveOneOut=leaveOneOutMeanProfiles(profiles);timing.profile+=performance.now()-start;const commons:number[][]=[],cellStart=performance.now(),out=records.map((r,index)=>{const common=commonBounds(leaveOneOut[index]);commons.push(common);const b=localRefine(r.projection,common);return makeCrop('H78',r,b)});timing.cells+=performance.now()-cellStart;return{routes:out,globalCommonBounds,commonBounds:commons}}

export function cropMachineCells(cv:OpenCv,raw:GrayImage,homography:number[],rectified:GrayImage,geometry:RowBoundaryModel,cells:MachineCell[]):CropCardResult{const started=performance.now(),rectifiedMat=new cv.Mat(950,570,cv.CV_8UC1),rawMat=new cv.Mat(raw.height,raw.width,cv.CV_8UC1);rectifiedMat.data.set(rectified.data);rawMat.data.set(raw.data);let commonPreprocessingMs=0,h75Ms=0,h76Ms=0,selectorMs=0;const ht={profile:0,cells:0};try{const inverse=invert3x3(homography),commonStart=performance.now(),base=buildRecords(cv,rectifiedMat,rawMat,inverse,geometry,cells,false),enhanced=buildRecords(cv,rectifiedMat,rawMat,inverse,geometry,cells,true);commonPreprocessingMs=performance.now()-commonStart;let s=performance.now(),h75=h75Or76(base.records,'H75');h75Ms=performance.now()-s;s=performance.now();const h76=h75Or76(enhanced.records,'H76');h76Ms=performance.now()-s;const h78Results=h78(base.records,ht),output:CropCellResult[]=[];for(let i=0;i<cells.length;i++){s=performance.now();const routes={H75:h75.routes[i],H76:h76.routes[i],H78:h78Results.routes[i]},selected=selectCropRoute([routes.H75,routes.H76,routes.H78]);selectorMs+=performance.now()-s;output.push({...cells[i],selectedRoute:selected.route,selected,routes})}const h75Paths=pathsAsRecords(base.paths.global,base.paths.columns),h76Paths=pathsAsRecords(enhanced.paths.global,enhanced.paths.columns);return{cells:output,diagnostics:{h75:{...h75Paths,calibration:h75.calibration,baseBounds:h75.baseBounds},h76:{...h76Paths,calibration:h76.calibration,baseBounds:h76.baseBounds},h78:{globalCommonBounds:h78Results.globalCommonBounds,commonBounds:h78Results.commonBounds}},timing:{commonPreprocessingMs,h75Ms,h76Ms,h78ProfileMs:ht.profile,h78CellsMs:ht.cells,selectorMs,totalMs:performance.now()-started}}}finally{rectifiedMat.delete();rawMat.delete()}}

export function cropMachineStamps(cv:OpenCv,raw:GrayImage,homography:number[],rectified:GrayImage,geometry:RowBoundaryModel,presence:PresenceCellResult[]):CropCardResult {
  const cells:MachineCell[]=presence.filter(c=>c.classification==='machine_stamp').map(c=>({row:c.row,column:c.column}))
  return cropMachineCells(cv,raw,homography,rectified,geometry,cells)
}

/** DEV parity probe. It reuses the production H72 patch and score primitives. */
export function diagnoseH72Cell(cv:OpenCv,raw:GrayImage,homography:number[],rectified:GrayImage,geometry:RowBoundaryModel,cell:MachineCell,colonX:number):H72CellDiagnostics{
  const rectifiedMat=new cv.Mat(rectified.height,rectified.width,cv.CV_8UC1),rawMat=new cv.Mat(raw.height,raw.width,cv.CV_8UC1)
  try{rectifiedMat.data.set(rectified.data);rawMat.data.set(raw.data);const centerX=(cell.column-1)*94+47,top=lineY(geometry.rows[cell.row].top,centerX),bottom=lineY(geometry.rows[cell.row].bottom,centerX),x=(cell.column-1)*94,y=Math.max(0,Math.trunc(Math.min(top,bottom))+3),y2=Math.min(rectified.height,Math.trunc(Math.max(top,bottom))-3),preData=new Uint8Array(94*(y2-y));for(let row=0;row<y2-y;row++)preData.set(rectified.data.subarray((y+row)*rectified.width+x,(y+row)*rectified.width+x+94),row*94);const resized=resizePatch(cv,rectifiedMat,x,y,94,y2-y);if(!resized)throw Error('empty row patch');const normalized=normalizedPatch(resized),background=percentile(Float32Array.from(resized.data),90),low=percentile(Float32Array.from(resized.data),5),absolute=x+colonX,row=geometry.rows[cell.row],quad=[absolute-47,lineY(row.top,absolute-47),absolute+47,lineY(row.top,absolute+47),absolute+47,lineY(row.bottom,absolute+47),absolute-47,lineY(row.bottom,absolute-47)].map(Math.fround),inverse=invert3x3(homography),rawPoints:number[]=[];for(let i=0;i<quad.length;i+=2)rawPoints.push(...transformPoint(inverse,quad[i],quad[i+1]));const rawCell=warpQuad(cv,rawMat,rawPoints,188,64);return{cell,geometry:{centerX,top,bottom,crop:{x,y,width:94,height:y2-y}},preResize:{width:94,height:y2-y,data:preData,...numericSummary(preData)},resized:{width:94,height:24,data:resized.data,...numericSummary(resized.data)},normalized:{width:94,height:24,data:normalized,...numericSummary(normalized),denominator:Math.max(background-low,20)},rawCell:{width:188,height:64,...numericSummary(rawCell.data)},baseScores:Array.from({length:54},(_,i)=>colonScoreDetails(cv,normalized,i+16,false)),enhancedScores:Array.from({length:54},(_,i)=>colonScoreDetails(cv,normalized,i+16,true))}}finally{rectifiedMat.delete();rawMat.delete()}
}

/** DEV parity probe for Python/OpenCV raw-cell geometry and pixels. */
export function diagnoseRawWarpCell(cv:OpenCv,raw:GrayImage,rectified:GrayImage,homography:number[],geometry:RowBoundaryModel,cell:MachineCell,colonX:number):RawWarpDiagnostics{
  const rawMat=new cv.Mat(raw.height,raw.width,cv.CV_8UC1),rectifiedMat=new cv.Mat(rectified.height,rectified.width,cv.CV_8UC1),absolute=(cell.column-1)*94+colonX,row=geometry.rows[cell.row],q=[absolute-47,lineY(row.top,absolute-47),absolute+47,lineY(row.top,absolute+47),absolute+47,lineY(row.bottom,absolute+47),absolute-47,lineY(row.bottom,absolute-47)].map(Math.fround),inverse=invert3x3(homography),sourceF64:number[]=[]
  for(let index=0;index<q.length;index+=2)sourceF64.push(...transformPoint(inverse,q[index],q[index+1]))
  const sourceF32=sourceF64.map(Math.fround),destination=[0,0,188,0,188,64,0,64],rawSource=cv.matFromArray(4,1,cv.CV_32FC2,sourceF32),rawDestination=cv.matFromArray(4,1,cv.CV_32FC2,destination),localSource=cv.matFromArray(4,1,cv.CV_32FC2,q),localDestination=cv.matFromArray(4,1,cv.CV_32FC2,[0,0,94,0,94,32,0,32]),rawMatrix=cv.getPerspectiveTransform(rawSource,rawDestination),localMatrix=cv.getPerspectiveTransform(localSource,localDestination),rawOutput=new cv.Mat(),localOutput=new cv.Mat()
  try{rawMat.data.set(raw.data);rectifiedMat.data.set(rectified.data);cv.warpPerspective(rawMat,rawOutput,rawMatrix,new cv.Size(188,64),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255));cv.warpPerspective(rectifiedMat,localOutput,localMatrix,new cv.Size(94,32),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255));const rawCell:GrayImage={width:188,height:64,data:new Uint8Array(rawOutput.data)},localCell:GrayImage={width:94,height:32,data:new Uint8Array(localOutput.data)},h22=h22Band(localCell),bandData=rawCell.data.slice(2*h22[0]*188,2*h22[1]*188),band:GrayImage={width:188,height:2*(h22[1]-h22[0]),data:bandData},source=Float32Array.from(bandData),p90=percentile(source,90),p4=percentile(source,4),denominator=Math.max(p90-p4,28),dark=darkness(band),mask=Uint8Array.from(dark,value=>value>=36?1:0),projected=new Float32Array(188);for(let y=0;y<band.height;y++)for(let x=0;x<188;x++)projected[x]+=mask[y*188+x];return{qH44F32:q,inverseH:inverse,rawSourceF64:sourceF64,rawSourceF32:sourceF32,rawMatrix:Array.from(rawMatrix.data64F),destination,rawCell,localMatrix:Array.from(localMatrix.data64F),localCell,h22,band,darkness:{p90,p4,denominator,data:dark},strong36Mask:mask,projection:projected}}finally{rawMat.delete();rectifiedMat.delete();rawSource.delete();rawDestination.delete();localSource.delete();localDestination.delete();rawMatrix.delete();localMatrix.delete();rawOutput.delete();localOutput.delete()}
}

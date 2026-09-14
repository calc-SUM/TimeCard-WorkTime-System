export const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x))
export function percentile(v:ArrayLike<number>,q:number){const a=Array.from(v).sort((x,y)=>x-y),p=(a.length-1)*q/100,i=Math.floor(p),f=p-i;return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*f}
export const mean=(a:ArrayLike<number>)=>Array.from(a).reduce((s,x)=>s+x,0)/a.length
export function std(a:ArrayLike<number>){const m=mean(a);return Math.sqrt(Array.from(a).reduce((s,x)=>s+(x-m)**2,0)/a.length)}
export function fit(xs:number[],ys:number[],weights?:number[]){let sw=0,sx=0,sy=0,sxx=0,sxy=0;xs.forEach((x,i)=>{const w=weights?.[i]??1;sw+=w;sx+=w*x;sy+=w*ys[i];sxx+=w*x*x;sxy+=w*x*ys[i]});const slope=(sw*sxy-sx*sy)/(sw*sxx-sx*sx);return{slope,intercept:(sy-slope*sx)/sw}}
export function convolve(v:ArrayLike<number>){const o=new Float64Array(v.length);for(let i=0;i<v.length;i++)o[i]=(i?v[i-1]:0)*.2+v[i]*.6+(i+1<v.length?v[i+1]:0)*.2;return o}

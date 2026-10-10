// オクターブ帯域ごとの平均パワー(dB, 最大帯域=0) と >300Hz のステレオ相関 / Side比
const fs=require('fs');
function fft(re,im){const n=re.length;for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
for(let len=2;len<=n;len<<=1){const a=-2*Math.PI/len;for(let i=0;i<n;i+=len)for(let k=0;k<len/2;k++){const c=Math.cos(a*k),s=Math.sin(a*k);const ur=re[i+k],ui=im[i+k];const vr=re[i+k+len/2]*c-im[i+k+len/2]*s,vi=re[i+k+len/2]*s+im[i+k+len/2]*c;re[i+k]=ur+vr;im[i+k]=ui+vi;re[i+k+len/2]=ur-vr;im[i+k+len/2]=ui-vi;}}}
const edges=[31,63,125,250,500,1000,2000,4000,8000,16000];
for(const f of process.argv.slice(2)){
  const b=fs.readFileSync(f), sr=b.readUInt32LE(24), n=(b.length-44)/4; const N=4096;
  const P=new Float64Array(N/2); let mid=0, side=0;
  for(let off=0;off+N<=n;off+=N){ const re=new Float64Array(N), im=new Float64Array(N), re2=new Float64Array(N), im2=new Float64Array(N);
    for(let i=0;i<N;i++){const w=0.5-0.5*Math.cos(2*Math.PI*i/N); const l=b.readInt16LE(44+(off+i)*4)/32768, r=b.readInt16LE(46+(off+i)*4)/32768; re[i]=(l+r)/2*w; re2[i]=(l-r)/2*w;}
    fft(re,im); fft(re2,im2);
    for(let k=1;k<N/2;k++){ const pm=re[k]**2+im[k]**2, ps=re2[k]**2+im2[k]**2; P[k]+=pm+ps; if(k*sr/N>300){mid+=pm; side+=ps;} } }
  const bands=[]; for(let e=0;e<edges.length-1;e++){ let s=0; for(let k=1;k<N/2;k++){const fr=k*sr/N; if(fr>=edges[e]&&fr<edges[e+1]) s+=P[k];} bands.push(s); }
  const mx=Math.max(...bands);
  console.log(f.split('/').pop().padEnd(16), bands.map((s,i)=>`${edges[i]}:${(10*Math.log10(s/mx)).toFixed(0)}`).join(' '), ` side/mid(>300Hz) ${(10*Math.log10(side/mid)).toFixed(1)}dB`);
}

// WAV(16bit) を解析: 長さ・ピーク・RMS・ループ継ぎ目・簡易スペクトル(帯域別エネルギー)・クリップ数
const fs=require('fs');
const files=process.argv.slice(2); const path=require('path'); let meta={}; try{meta=JSON.parse(fs.readFileSync(path.join(path.dirname(files[0]),'meta.json')))}catch(e){}
function bands(x, sr){ // 単純な DFT ではなく、1次IIRフィルタで帯域分割（low<250, mid 250-4k, high>4k）
  const a=(fc)=>1-Math.exp(-2*Math.PI*fc/sr); let l=0,m=0, el=0, em=0, eh=0; const a1=a(250), a2=a(4000);
  for(let i=0;i<x.length;i++){ l+=a1*(x[i]-l); m+=a2*(x[i]-m); const low=l, mid=m-l, hi=x[i]-m; el+=low*low; em+=mid*mid; eh+=hi*hi; }
  const tot=el+em+eh; return [el/tot,em/tot,eh/tot].map(v=>(v*100).toFixed(0)+'%').join('/');
}
for (const f of files){
  const b=fs.readFileSync(f); const nc=b.readUInt16LE(22), sr=b.readUInt32LE(24); const n=(b.length-44)/2/nc;
  const L=new Float32Array(n), R=new Float32Array(n);
  for(let i=0;i<n;i++){ L[i]=b.readInt16LE(44+i*4)/32768; R[i]=b.readInt16LE(46+i*4)/32768; }
  let pk=0, ss=0, clip=0, d=0, dmax=0; for(let i=0;i<n;i++){ const a=Math.max(Math.abs(L[i]),Math.abs(R[i])); if(a>pk)pk=a; if(a>0.999)clip++; ss+=L[i]*L[i]+R[i]*R[i]; if(i){ const dd=Math.abs(L[i]-L[i-1]); d+=dd; if(dd>dmax)dmax=dd; } }
  const rms=Math.sqrt(ss/(2*n)); const db=v=>(20*Math.log10(v)).toFixed(1);
  // 1秒ごとの RMS の最小値（無音区間がないか）
  let minS=1; for(let s=0;s+sr<=n;s+=sr){ let q=0; for(let i=s;i<s+sr;i++) q+=L[i]*L[i]; minS=Math.min(minS,Math.sqrt(q/sr)); }
  // ループ継ぎ目: 末尾→先頭のジャンプ量と平均的なサンプル間差分の比
  const nm=path.basename(f).replace(/\.wav$/,''); const i0=Math.round(((meta[nm]||{}).intro||0)*sr); const seam=Math.max(Math.abs(L[i0]-L[n-1]), Math.abs(R[i0]-R[n-1])); const avgd=d/(n-1);
  // 相関（ステレオ幅）
  let lr=0, ll=0, rr=0, pl=0, pr=0; const ah=1-Math.exp(-2*Math.PI*300/sr); for(let i=0;i<n;i++){ pl+=ah*(L[i]-pl); pr+=ah*(R[i]-pr); const hl=L[i]-pl, hr=R[i]-pr; lr+=hl*hr; ll+=hl*hl; rr+=hr*hr; }
  console.log(`${f.split('/').pop().padEnd(16)} ${(n/sr).toFixed(3)}s ${sr}Hz peak ${db(pk)}dBFS rms ${db(rms)}dBFS crest ${(db(pk)-db(rms)).toFixed(1)}dB clip=${clip} min1sRMS ${db(minS)}dB seamJump ${seam.toFixed(4)} (avgStep ${avgd.toFixed(4)}, max ${dmax.toFixed(3)}) LRcorr(>300Hz) ${(lr/Math.sqrt(ll*rr)).toFixed(2)} bands L/M/H ${bands(L,sr)}`);
}

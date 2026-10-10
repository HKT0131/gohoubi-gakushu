// ループ継ぎ目の検査: 2次予測誤差 |x[i0] - (2x[n-1]-x[n-2])| が、曲中の予測誤差分布の何パーセンタイルか
const fs=require('fs'),path=require('path'); const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'out/meta.json')));
for(const f of process.argv.slice(2)){ const b=fs.readFileSync(f), sr=b.readUInt32LE(24), n=(b.length-44)/4; const nm=path.basename(f,'.wav');
  const x=new Float32Array(n); for(let i=0;i<n;i++) x[i]=b.readInt16LE(44+i*4)/32768;
  const i0=Math.round((meta[nm].intro||0)*sr);
  const e=[]; for(let i=i0+2;i<n;i+=7) e.push(Math.abs(x[i]-(2*x[i-1]-x[i-2]))); e.sort((a,b)=>a-b);
  const se=Math.abs(x[i0]-(2*x[n-1]-x[n-2])); const se2=Math.abs(x[i0+1]-(2*x[i0]-x[n-1]));
  const pct=v=>(100*e.findIndex(q=>q>=v)/e.length).toFixed(1);
  console.log(nm.padEnd(12), `seamErr ${se.toFixed(5)} (p${pct(se)}), next ${se2.toFixed(5)} (p${pct(se2)}), median ${e[e.length>>1].toFixed(5)}, p99 ${e[Math.floor(e.length*.99)].toFixed(5)}`);
}

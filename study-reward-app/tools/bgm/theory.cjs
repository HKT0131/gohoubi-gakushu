const fs=require('fs'); const win={console, addEventListener(){}};
new Function('window', fs.readFileSync('/Users/hkt/bizdev/study-reward-app/bgm.js','utf8'))(win);
const B=win.GameBGM; const N=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const SC={major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]}; const PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
for (const t of B.tracks){
  const s=B._compile(t), d=s.def; const key=PC[d.key[0]]+(d.key[1]==='b'?-1:d.key[1]==='#'?1:0);
  const scale=SC[d.mode].map(x=>(x+key+12)%12);
  let out=[], strong=0, strongOk=0, nNotes=0, nonDia=0;
  for (const nt of s.mel){ nNotes++;
    const ch=s.chordAt(nt.s), pc=nt.n%12, inCh=ch.pcs.includes(pc), inSc=scale.includes(pc);
    if(!inSc){ nonDia++; if(!inCh) out.push(`bar${Math.floor(nt.s/16)+1} ${N[pc]} out of scale & chord ${ch.name}`); }
    if (nt.s%8===0){ strong++; if(inCh) strongOk++; else out.push(`bar${Math.floor(nt.s/16)+1} step${nt.s%16} ${N[pc]} not chord tone of ${ch.name}`); }
    // 長い音がコードチェンジをまたぐ場合
    for (let k=nt.s+1;k<nt.s+nt.d;k++) if (k%8===0){ const c2=s.chordAt(k); if(!c2.pcs.includes(pc)) out.push(`bar${Math.floor(k/16)+1} held ${N[pc]} over ${c2.name}`); }
  }
  // 半音でぶつかる(短2度/短9度)メロ×コード構成音 on strong beats
  console.log(`${t}: ${d.bpm}BPM ${d.key} ${d.mode}, bars=${d.form.length} intro=${d.intro||0}, notes=${nNotes}, strong-beat chord tones ${strongOk}/${strong}, chromatic(non-diatonic)=${nonDia}, events=${s.steps.reduce((a,x)=>a+x.length,0)}, loop=${(s.loopSteps*s.stepDur).toFixed(3)}s`);
  if (s.warn.length) console.log('  WARN', s.warn);
  out.forEach(x=>console.log('  -',x));
}

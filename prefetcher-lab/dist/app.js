const patterns={
  sequential:[0,1,2,3,4,5,6,7,8,9,10,11],
  stride:[0,3,6,9,12,15,18,21,24,27,30,33],
  alternating:[0,1,4,5,8,9,12,13,16,17,20,21],
  page:[60,61,62,63,64,65,66,67,68,69,70,71],
  irregular:[0,7,2,11,3,19,6,25,8,18,4,29]
};

const papers=[
  {id:'vip',name:'VIP',level:'Cross-page · L1 observer',title:'Virtual-address Based Inter-Page Prefetching',problem:'물리 주소 기반 L2 프리페처가 4 KB page boundary를 넘지 못해 연속 stream을 끊는 문제.',idea:'L1D miss stream을 virtual address로 관측해 page 간 stride를 학습하고, TLB가 정확성과 권한을 확인한 뒤 physical prefetch를 발행한다.',flow:['VA miss stream','IP-correlated predictor','TLB verification','PA prefetch'],notice:'기존 L1/L2 예측기를 바꾸지 않고, 서로 다른 주소 공간의 장점을 이어 붙인다.',pdf:'VIP-final.pdf'},
  {id:'sppam',name:'SPPAM',level:'Signature + spatial · L2',title:'Signature Pattern Prediction and Access-Map',problem:'SPP는 재정렬에 민감하고 AMPM은 한 region 밖으로 예측을 확장하기 어렵다.',idea:'온라인으로 access-map pattern을 학습하고 signature 기반 speculative lookahead를 수행한다. confidence가 재귀 깊이와 공격성을 제한한다.',flow:['Access map','Pattern learning','Signature lookahead','Confidence gate'],notice:'시간 순서의 signature와 재정렬에 강한 공간적 bitmap을 결합한 방식에 주목한다.',pdf:'SPPAM-final.pdf'},
  {id:'emender',name:'Emender',level:'Priority + throttling · hierarchy',title:'Optimizing Priority and Throttling',problem:'VBerti + Pythia가 중복 요청과 낮은 가치의 요청에 자원을 쓰고, multicore에서 불공정해지는 문제.',idea:'Pending Target Buffer로 우선순위를 정하고 Cuckoo Filter로 중복을 제거한다. miss-rate 기반 confidence와 L3 fairness feedback으로 공격성을 조절한다.',flow:['VBerti/Pythia','Priority queue','Duplicate filter','Fair throttle'],notice:'더 많은 예측보다, 이미 생성된 요청을 선별하고 억제하는 control plane이 핵심이다.',pdf:'Emender-final.pdf'},
  {id:'sberti',name:'sBerti',level:'Hybrid stride · L1D',title:'Berti + Smart Stride',problem:'local delta에 강한 Berti가 AI/ML의 긴 streaming pattern을 충분히 포착하지 못하는 문제.',idea:'Berti에 confidence와 timeliness를 추적하는 high-degree stride engine을 더하고 page boundary를 넘어 예측한다.',flow:['Berti deltas','Stride detector','Adaptive degree','Cross-page issue'],notice:'복잡한 패턴용 예측기와 단순하지만 공격적인 stream 예측기를 병렬로 쓰는 hybrid 설계다.',pdf:'sBerti-final.pdf'},
  {id:'bertigo',name:'BertiGO',level:'Context + filtering · multi-level',title:'Pushing Berti to Its Limits',problem:'Berti가 cache에 이미 있는 line을 반복 요청하고, 현재 IP만으로는 실행 문맥을 구분하기 어려운 문제.',idea:'region bitmap filter가 중복·불필요 요청을 막고 IP-path signature가 context를 추가한다. L2/LLC 정책은 set dueling으로 선택한다.',flow:['Berti','Region filter','IP-path context','Policy selection'],notice:'정확한 predictor도 filtering과 context가 없으면 hierarchy 자원을 낭비할 수 있다.',pdf:'BertiGO-final.pdf'},
  {id:'edp',name:'EDP',level:'Trigger decoupling · L1D',title:'The Entangling Data Prefetcher',problem:'예측 IP와 trigger IP가 같으면 zero-delta·long-reuse를 놓치고, 다르면 복잡한 delta pattern의 timely issue가 어렵다.',idea:'target을 예측하는 IP와 더 일찍 요청을 시작하는 IP를 연결한다. local delta로 복잡한 패턴을 다루고 queue와 Bloom filter로 자원을 관리한다.',flow:['Target IP','Local delta relation','Earlier trigger IP','Queued request'],notice:'무엇을 예측할지뿐 아니라 어느 명령에서 일찍 발행할지가 timeliness를 결정한다.',pdf:'EDP-final.pdf'},
  {id:'umama',name:'uMAMA',level:'Bandit ensemble · L1/L2',title:'Performance-Driven Composite Prefetching',problem:'accuracy·coverage 같은 proxy metric이 항상 실제 IPC 향상과 일치하지 않고, 단일 predictor가 모든 pattern을 다루기 어렵다.',idea:'L1 Berti와 L2의 여러 경량 predictor를 구성하고 multi-armed bandit이 성능 피드백으로 선택한다. multicore에는 fairness arbitrator를 둔다.',flow:['Prefetcher ensemble','Performance reward','Bandit selection','Fair arbitration'],notice:'저수준 metric이 아니라 최종 performance를 reward로 삼는 online control 관점이다.',pdf:'uMAMA-final.pdf'},
  {id:'gberti',name:'gBerti',level:'Streaming + spatial · L1D',title:'Global Berti',problem:'Berti가 한 instruction의 일정 delta stream은 찾지만 여러 instruction이 만드는 spatial pattern을 놓치는 문제.',idea:'같은 Berti table을 두 방향으로 조회해 per-IP stream과 cross-IP spatial 관계를 동시에 발견한다.',flow:['Berti table','IP-oriented view','Address-oriented view','Dual prediction'],notice:'새 거대 구조 대신 기존 metadata의 조회 관점을 바꿔 두 패턴 계열을 포착한다.',pdf:'GBerti-final.pdf'}
];

const $=s=>document.querySelector(s);
let step=0, issued=new Map(), stats={issued:0,useful:0,late:0};
function prediction(seq,i,type,distance,degree){
  if(type==='none'||i<0)return [];
  const cur=seq[i], out=[];
  if(type==='next') for(let d=1;d<=degree;d++) out.push(cur+d);
  if(type==='stride'){
    const delta=i>0?seq[i]-seq[i-1]:1;
    for(let d=1;d<=degree;d++) out.push(cur+delta*(distance+d-1));
  }
  if(type==='delta'){
    const ds=[]; for(let j=1;j<=i;j++) ds.push(seq[j]-seq[j-1]);
    const next=ds.length>1?ds[(ds.length)%Math.min(ds.length,2)]:1;
    let v=cur; for(let d=0;d<distance+degree-1;d++){v+=ds.length?ds[(ds.length+d)%Math.min(ds.length,2)]||next:next;if(d>=distance-1)out.push(v)}
  }
  if(type==='spatial'){
    const region=Math.floor(cur/8)*8; const offsets=[1,3,4,6];
    offsets.slice(0,degree).forEach(o=>out.push(region+((cur-region+o)%8)));
  }
  return [...new Set(out)];
}
function render(){
  const seq=patterns[$('#pattern').value], type=$('#prefetcher').value;
  const degree=+$('#degree').value,distance=+$('#distance').value;
  $('#degreeOut').textContent=degree;$('#distanceOut').textContent=distance;
  const current=Math.min(step,seq.length-1), addr=seq[current];
  let state='demand';
  if(issued.has(addr)){const lead=current-issued.get(addr);if(lead>=distance){stats.useful++;state='hit'}else{stats.late++;state='prefetched'}issued.delete(addr)}
  const preds=prediction(seq,current,type,distance,degree);
  preds.forEach(a=>{if(!issued.has(a)&&!seq.slice(0,current+1).includes(a)){issued.set(a,current);stats.issued++}});
  $('#addressLine').innerHTML=seq.map((a,i)=>`<div class="cell ${i===current?'current':i<current?'hit':'future'}" title="line ${a}">${a}</div>`).join('');
  preds.forEach(a=>{const idx=seq.indexOf(a,current+1);if(idx>=0){const cell=$('#addressLine').children[idx];cell.classList.remove('future');cell.classList.add(idx-current<distance?'prefetched':'hit')}});
  const accuracy=stats.issued?Math.round(stats.useful/stats.issued*100):0;
  const opportunities=current||1,coverage=Math.round(stats.useful/opportunities*100),timely=(stats.useful+stats.late)?Math.round(stats.useful/(stats.useful+stats.late)*100):0;
  $('#accuracy').textContent=accuracy+'%';$('#coverage').textContent=Math.min(100,coverage)+'%';$('#timely').textContent=timely+'%';$('#traffic').textContent=stats.issued;$('#cycle').textContent=`ACCESS ${String(current+1).padStart(2,'0')} / 12`;
  const msg=type==='none'?'프리페치가 없으므로 추가 traffic은 없지만 모든 새 line이 demand access가 된다.':preds.length?`line ${addr} 관측 후 ${preds.map(v=>'L'+v).join(', ')}을 예측했다. ${distance===1?'짧은 lookahead는 late 위험이 있다.':'먼 lookahead는 지연을 숨기지만 자원을 더 오래 점유한다.'}`:'패턴을 학습할 history가 아직 부족하다.';
  $('#explain').textContent=msg;
  if(step<seq.length-1)step++;
}
function reset(){step=0;issued=new Map();stats={issued:0,useful:0,late:0};render()}

function showPaper(id){
  const p=papers.find(x=>x.id===id); document.querySelectorAll('.paper-button').forEach(b=>b.classList.toggle('active',b.dataset.id===id));
  $('#paperDetail').innerHTML=`<span class="tag">${p.level.toUpperCase()}</span><h3>${p.name}</h3><p><strong>${p.title}</strong></p><h4>해결하려는 문제</h4><p>${p.problem}</p><h4>핵심 아이디어</h4><p>${p.idea}</p><div class="flow">${p.flow.map((x,i)=>`${i?'<i>→</i>':''}<span>${x}</span>`).join('')}</div><h4>읽을 때 주목할 점</h4><p>${p.notice}</p><a href="https://github.com/CMU-SAFARI/DPC4/blob/main/final-versions/${p.pdf}" target="_blank" rel="noreferrer">Official final paper ↗</a>`;
}
function initPapers(){
  $('#paperList').innerHTML=papers.map((p,i)=>`<button class="paper-button ${i===0?'active':''}" data-id="${p.id}" role="listitem"><b>${p.name}</b><span>${p.level}</span></button>`).join('');
  $('#paperList').addEventListener('click',e=>{const b=e.target.closest('button');if(b)showPaper(b.dataset.id)});showPaper('vip');
}
$('#step').addEventListener('click',render);$('#reset').addEventListener('click',reset);
['pattern','prefetcher'].forEach(id=>$('#'+id).addEventListener('change',reset));['degree','distance'].forEach(id=>$('#'+id).addEventListener('input',()=>{id==='degree'?$('#degreeOut').textContent=$('#degree').value:$('#distanceOut').textContent=$('#distance').value}));
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();render()}});
$('#theme').addEventListener('click',()=>{document.body.classList.toggle('dark');localStorage.setItem('prefetcher-theme',document.body.classList.contains('dark')?'dark':'light')});
if(localStorage.getItem('prefetcher-theme')==='dark'||(!localStorage.getItem('prefetcher-theme')&&matchMedia('(prefers-color-scheme: dark)').matches))document.body.classList.add('dark');
initPapers();reset();

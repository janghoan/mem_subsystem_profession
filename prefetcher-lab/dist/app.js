const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Navigation and reading progress
const chapters = $$('.chapter');
const navLinks = $$('.rail nav a');
const updateProgress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const value = max > 0 ? Math.min(100, Math.round(scrollY / max * 100)) : 0;
  $('#progressBar').style.width = `${value}%`;
  $('#progressText').textContent = `${value}% 읽음`;
  let current = chapters[0]?.id;
  chapters.forEach(section => { if (section.getBoundingClientRect().top < innerHeight * .42) current = section.id; });
  navLinks.forEach(link => link.classList.toggle('active', link.dataset.section === current));
};
addEventListener('scroll', updateProgress, { passive: true });
updateProgress();
$('#menuToggle').addEventListener('click', () => {
  const open = $('#rail').classList.toggle('open');
  $('#menuToggle').setAttribute('aria-expanded', String(open));
});
navLinks.forEach(link => link.addEventListener('click', () => $('#rail').classList.remove('open')));
$('#themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('prefetcher-lab-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});
if (localStorage.getItem('prefetcher-lab-theme') === 'dark') document.body.classList.add('dark');

// Lab 01: latency timeline
let latencyMode = 'off';
function renderLatency() {
  const latency = +$('#memLatency').value;
  const lookahead = +$('#lookahead').value;
  const demand = 10;
  const start = latencyMode === 'on' ? Math.max(0, demand - lookahead) : demand;
  const arrival = start + latency;
  const stall = Math.max(0, arrival - demand);
  const scale = 4.5;
  $('#memLatencyOut').textContent = `${latency} cycles`;
  $('#lookaheadOut').textContent = `${lookahead} cycles`;
  $('#requestBar').style.left = `${start * scale}%`;
  $('#requestBar').style.width = `${latency * scale}%`;
  $('#arrivalMarker').style.left = `${Math.min(96, arrival * scale)}%`;
  $('#stallBar').style.left = '45%';
  $('#stallBar').style.width = `${stall * scale}%`;
  $('#resumeBar').style.left = `${Math.min(96, arrival * scale)}%`;
  $('#resumeBar').style.width = `${Math.max(0, 95 - arrival * scale)}%`;
  if (latencyMode === 'off') {
    $('#latencyBadge').textContent = 'DEMAND MISS';
    $('#stallCycles').textContent = `${latency}-cycle stall`;
    $('#latencyExplain').textContent = 'Demand가 발생한 뒤 memory request를 보내므로 전체 지연이 critical path에 놓인다.';
  } else if (stall === 0) {
    $('#latencyBadge').textContent = 'TIMELY';
    $('#stallCycles').textContent = '0-cycle stall';
    $('#latencyExplain').textContent = `Demand보다 ${Math.max(0, demand - arrival)} cycle 먼저 도착했다. 맞는 주소와 충분한 lookahead가 모두 충족됐다.`;
  } else {
    $('#latencyBadge').textContent = 'LATE PREFETCH';
    $('#stallCycles').textContent = `${stall}-cycle stall`;
    $('#latencyExplain').textContent = `주소는 맞았지만 lookahead ${lookahead}가 latency ${latency}보다 짧다. ${stall} cycle만큼 지연이 남는다.`;
  }
}
$$('[data-latency-mode]').forEach(button => button.addEventListener('click', () => {
  latencyMode = button.dataset.latencyMode;
  $$('[data-latency-mode]').forEach(item => item.classList.toggle('active', item === button));
  renderLatency();
}));
['memLatency', 'lookahead'].forEach(id => $(`#${id}`).addEventListener('input', renderLatency));
renderLatency();

// Lab 02: trace microscope
const tracePatterns = {
  sequential: {
    values: [100,101,102,103,104,105,106,107,108,109,110,111],
    notes: [['SIGNAL','constant delta','매 접근 사이 delta가 +1이다. 주소 하나만 기억해도 다음 line을 예측할 수 있다.'],['GOOD FIT','next-line / stream','가장 작은 metadata로 높은 coverage를 얻는다.'],['FAILURE','branch or boundary','stream이 끝났는데 계속 발행하면 unused traffic이 된다.']]
  },
  stride: {
    values: [40,43,46,49,52,55,58,61,64,67,70,73],
    notes: [['SIGNAL','PC + last address','동일 PC가 반복해서 +3 delta를 만드는지 확인한다.'],['GOOD FIT','PC-stride','배열의 특정 field를 순회할 때 효과적이다.'],['FAILURE','interleaved PCs','서로 다른 instruction을 섞으면 하나의 global stride로 보이지 않는다.']]
  },
  alternating: {
    values: [20,21,24,25,28,29,32,33,36,37,40,41],
    notes: [['SIGNAL','delta history','+1, +3이라는 delta sequence가 반복된다.'],['GOOD FIT','delta / signature','최근 delta를 signature로 만들고 다음 delta를 찾는다.'],['FAILURE','history aliasing','서로 다른 문맥이 같은 짧은 signature를 만들 수 있다.']]
  },
  multistream: {
    values: [10,80,12,82,14,84,16,86,18,88,20,90],
    notes: [['SIGNAL','per-PC stream','global delta는 +70, -68로 복잡하지만 PC별로 분리하면 각각 +2다.'],['GOOD FIT','PC-indexed table','instruction context가 두 stream을 분리한다.'],['FAILURE','table conflict','많은 PC가 작은 table entry를 경쟁하면 학습 상태가 사라진다.']]
  },
  spatial: {
    values: [64,65,67,70,72,73,75,78,80,81,83,86],
    notes: [['SIGNAL','region bitmap','8-line region 안에서 offset 0,1,3,6이 반복된다.'],['GOOD FIT','access map','접근 순서가 바뀌어도 공간적 모양은 유지된다.'],['FAILURE','region transition','한 region 내부만 보면 다음 region으로 speculation하기 어렵다.']]
  },
  irregular: {
    values: [7,31,4,52,18,2,47,13,61,9,36,22],
    notes: [['SIGNAL','none locally','짧은 주소·delta history만으로 안정적인 규칙이 보이지 않는다.'],['POSSIBLE KEY','context / correlation','load PC, 이전 node, data value 같은 추가 문맥이 필요할 수 있다.'],['FAILURE','false confidence','억지로 규칙을 만들면 accuracy와 bandwidth가 함께 악화된다.']]
  }
};
let traceObserved = 4;
function renderTrace() {
  const data = tracePatterns[$('#tracePattern').value];
  $('#traceCells').innerHTML = data.values.map((value, index) => `<div class="trace-cell ${index < traceObserved ? 'observed' : 'hidden'} ${index === traceObserved ? 'next' : ''}">${index < traceObserved ? `L${value}` : '?'}</div>`).join('');
  $('#deltaCells').innerHTML = data.values.slice(1).map((value, index) => `<span class="${index < traceObserved - 1 ? '' : 'hidden'}">${index < traceObserved - 1 ? signed(value - data.values[index]) : '·'}</span>`).join('');
  $('#traceStepLabel').textContent = `${traceObserved} / ${data.values.length} observed`;
  $('#guessInput').value = data.values[Math.min(traceObserved, data.values.length - 1)];
  $('#patternNotes').innerHTML = data.notes.map(note => `<article><span>${note[0]}</span><h3>${note[1]}</h3><p>${note[2]}</p></article>`).join('');
  $('#traceFeedback').className = 'feedback';
  $('#traceFeedback').innerHTML = '<b>패턴을 찾아보자.</b><p>주소 자체보다 아래 delta sequence가 반복되는지 먼저 확인하세요.</p>';
}
function signed(value) { return value > 0 ? `+${value}` : String(value); }
$('#guessButton').addEventListener('click', () => {
  const data = tracePatterns[$('#tracePattern').value];
  const expected = data.values[traceObserved];
  const guessed = +$('#guessInput').value;
  const correct = guessed === expected;
  $('#traceFeedback').className = `feedback ${correct ? 'correct' : 'wrong'}`;
  $('#traceFeedback').innerHTML = correct
    ? `<b>맞았다 — L${expected}.</b><p>관측된 관계를 다음 주소로 정확히 extrapolate했다. 이제 한 단계 진행해 패턴이 유지되는지 검증하세요.</p>`
    : `<b>예측은 L${guessed}, 실제는 L${expected}.</b><p>delta sequence와 PC/region 같은 context 중 무엇이 빠졌는지 확인하세요. 틀린 예측도 predictor를 이해하는 evidence다.</p>`;
});
$('#traceNext').addEventListener('click', () => { traceObserved = Math.min(11, traceObserved + 1); renderTrace(); });
$('#traceReset').addEventListener('click', () => { traceObserved = 4; renderTrace(); });
$('#tracePattern').addEventListener('change', () => { traceObserved = 4; renderTrace(); });
renderTrace();

// Chapter 03: predictor taxonomy
const predictorTypes = [
  { id:'next', tab:'Next-line', family:'FIXED RULE · NO LEARNING', name:'Next-line', summary:'현재 line 다음의 연속 line을 항상 요청한다. 학습 table이 없어 매우 싸지만, sequential이라는 가정을 끌 수 있는 control이 중요하다.', facts:[['Key','current line'],['State','거의 없음'],['Strength','dense sequential'],['Weakness','branch, sparse access']], nodes:[['OBSERVE','line 100'],['RULE','address + 1'],['ISSUE','line 101']], example:'L100 → predict L101 · constant degree extends to L102, L103 …'},
  { id:'stride', tab:'Stride', family:'PC-CORRELATED · TEMPORAL', name:'PC-based stride', summary:'같은 load instruction이 만든 최근 주소 차이를 저장한다. 반복 delta의 confidence가 올라가면 그 stride를 미래 주소에 더한다.', facts:[['Key','load PC'],['State','last address, stride, confidence'],['Strength','array traversal'],['Weakness','alternating pattern']], nodes:[['INDEX','load PC'],['LEARN','Δ = current − last'],['EXTRAPOLATE','current + k·Δ']], example:'PC 0x48: L40, L43, L46 → Δ=+3 → predict L49, L52'},
  { id:'delta', tab:'Delta', family:'SEQUENCE · TEMPORAL', name:'Delta correlation', summary:'하나의 stride 대신 최근 delta들의 순서를 signature로 만든다. 같은 signature 뒤에 나타났던 delta를 찾아 복잡한 반복 패턴을 따라간다.', facts:[['Key','delta signature'],['State','history + pattern table'],['Strength','alternating deltas'],['Weakness','signature aliasing']], nodes:[['HISTORY','+1, +3, +1'],['SIGNATURE','hash(history)'],['LOOKUP','next Δ = +3']], example:'L20,21,24,25 → Δ [+1,+3,+1] → next Δ +3 → predict L28'},
  { id:'signature', tab:'Signature', family:'CONFIDENCE-GATED · RECURSIVE', name:'Signature path', summary:'delta signature에서 다음 delta와 confidence를 얻고, 예측한 주소를 다시 history에 넣어 여러 단계 ahead로 재귀 탐색한다.', facts:[['Key','rolling signature'],['State','pattern table + confidence'],['Strength','long lookahead'],['Weakness','error amplification']], nodes:[['SIGNATURE','S₀'],['PATTERN','Δ, confidence'],['RECURSE','S₁ → S₂']], example:'confidence product가 threshold 아래로 떨어질 때 speculative path를 중단'},
  { id:'spatial', tab:'Spatial', family:'REGION-CORRELATED · ORDER ROBUST', name:'Spatial access map', summary:'page나 region 내부에서 접근한 offset을 bitmap으로 표현한다. 정확한 시간 순서보다 “함께 접근되는 위치”를 기억해 재정렬에 강하다.', facts:[['Key','region + trigger offset'],['State','access bitmap'],['Strength','struct/layout pattern'],['Weakness','cross-region lookahead']], nodes:[['REGION','line ÷ 8'],['BITMAP','11010010'],['REPLAY','set offsets']], example:'region 8-line: offsets {0,1,3,6} → 다음 instance에서 같은 offsets prefetch'},
  { id:'hybrid', tab:'Hybrid', family:'ADAPTIVE · COMPOSITE', name:'Hybrid / ensemble', summary:'서로 다른 pattern에 강한 작은 predictor를 결합하고, confidence·set dueling·bandit 같은 정책이 발행 여부와 담당 predictor를 고른다.', facts:[['Key','context + performance'],['State','multiple predictors + selector'],['Strength','workload diversity'],['Weakness','coordination cost']], nodes:[['EXPERTS','stride · spatial · delta'],['CONTROL','score / reward'],['ADMIT','best candidates']], example:'stream phase에는 stride, sparse region에는 spatial, noise phase에는 no-prefetch'}
];
function renderType(id) {
  const type = predictorTypes.find(item => item.id === id);
  $$('#typeTabs button').forEach(button => button.classList.toggle('active', button.dataset.type === id));
  $('#typeFamily').textContent = type.family;
  $('#typeName').textContent = type.name;
  $('#typeSummary').textContent = type.summary;
  $('#typeFacts').innerHTML = type.facts.map(fact => `<dt>${fact[0]}</dt><dd>${fact[1]}</dd>`).join('');
  $('#predictorMachine').innerHTML = `<div class="machine-row">${type.nodes.map((node,index) => `${index ? '<span class="machine-arrow">→</span>' : ''}<div class="machine-node"><span><b>${node[0]}</b>${node[1]}</span></div>`).join('')}</div><div class="machine-example">EXAMPLE · ${type.example}</div>`;
}
$('#typeTabs').innerHTML = predictorTypes.map((type,index) => `<button role="tab" data-type="${type.id}" class="${index === 0 ? 'active' : ''}">${type.tab}</button>`).join('');
$('#typeTabs').addEventListener('click', event => { const button = event.target.closest('button'); if (button) renderType(button.dataset.type); });
renderType('next');

// Chapter 04: deterministic event model
const simTraces = {
  stream: Array.from({length:24}, (_,i) => 100 + i),
  mixed: [20,22,24,26,21,23,25,27,28,30,32,34,29,31,33,35,36,38,40,42,37,39,41,43],
  spatial: [64,65,67,70,72,73,75,78,80,81,83,86,88,89,91,94,96,97,99,102,104,105,107,110],
  irregular: [7,31,4,52,18,2,47,13,61,9,36,22,55,1,43,16,59,6,28,50,11,39,24,63]
};
function makePredictions(trace, index, type, degree, distance) {
  if (type === 'none') return [];
  const current = trace[index];
  let results = [];
  if (type === 'next') results = Array.from({length:degree}, (_,k) => current + distance + k);
  if (type === 'stride') {
    const delta = index > 0 ? trace[index] - trace[index-1] : 1;
    results = Array.from({length:degree}, (_,k) => current + delta * (distance + k));
  }
  if (type === 'delta') {
    const deltas = [];
    for (let i=Math.max(1,index-3); i<=index; i++) deltas.push(trace[i]-trace[i-1]);
    let address = current;
    for (let k=0; k<distance+degree-1; k++) {
      address += deltas.length ? deltas[k % deltas.length] : 1;
      if (k >= distance-1) results.push(address);
    }
  }
  if (type === 'spatial') {
    const base = Math.floor(current/8)*8;
    const map = [0,1,3,6,8,9,11,14];
    results = map.filter(offset => base+offset > current).slice(Math.max(0,distance-1), Math.max(0,distance-1)+degree).map(offset => base+offset);
  }
  return [...new Set(results)];
}
function simulate(trace, config, latency) {
  const pending = new Map();
  const seenDemand = new Set();
  const events = [];
  let issued=0, useful=0, late=0, misses=0, redundant=0, maxOutstanding=0;
  trace.forEach((address,index) => {
    const time = index * 3;
    let kind = 'miss';
    if (pending.has(address)) {
      const arrival = pending.get(address);
      if (arrival <= time) { useful++; kind='hit'; }
      else { late++; kind='late'; }
      pending.delete(address);
    } else { misses++; }
    seenDemand.add(address);
    makePredictions(trace,index,config.type,config.degree,config.distance).forEach(predicted => {
      if (seenDemand.has(predicted) || pending.has(predicted)) { redundant++; return; }
      pending.set(predicted,time+latency); issued++;
    });
    for (const [predicted,arrival] of pending) if (arrival < time - 24) pending.delete(predicted);
    maxOutstanding = Math.max(maxOutstanding,pending.size);
    events.push({address,kind});
  });
  const unused = Math.max(0,issued-useful-late);
  const accuracy = issued ? useful/issued : 0;
  const coverage = useful/(useful+misses || 1);
  const timely = useful/(useful+late || 1);
  const score = useful*6 - late*1.5 - unused*.65 - issued*.12;
  return {issued,useful,late,misses,unused,redundant,maxOutstanding,accuracy,coverage,timely,score,events};
}
function configFrom(card) { return {type:$('.cfg-type',card).value,degree:+$('.cfg-degree',card).value,distance:+$('.cfg-distance',card).value}; }
function pct(value) { return `${Math.round(value*100)}%`; }
function renderMini(card,result) {
  $('.mini-metrics',card).innerHTML = `<div><b>${pct(result.accuracy)}</b><span>ACCURACY</span></div><div><b>${pct(result.coverage)}</b><span>COVERAGE</span></div><div><b>${pct(result.timely)}</b><span>TIMELY</span></div><div><b>${result.issued}</b><span>TRAFFIC</span></div><div><b>${result.late}</b><span>LATE</span></div><div><b>${result.unused}</b><span>UNUSED</span></div>`;
}
function runSimulation() {
  const trace = simTraces[$('#simPattern').value];
  const latency = +$('#simLatency').value;
  const cards = $$('.config-card');
  const a = simulate(trace,configFrom(cards[0]),latency);
  const b = simulate(trace,configFrom(cards[1]),latency);
  renderMini(cards[0],a); renderMini(cards[1],b);
  const winner = a.score === b.score ? null : a.score > b.score ? 'A' : 'B';
  $('#winner').innerHTML = `<span>CONCEPT SCORE</span><strong>${winner ? `Config ${winner} leads` : 'Even trade-off'}</strong><p>useful을 보상하고 late·unused·traffic을 감점한 교육용 비교다.</p>`;
  const selected = winner === 'B' ? b : a;
  $('#eventTitle').textContent = `Config ${winner || 'A'} · ${selected.useful} useful / ${selected.issued} issued`;
  $('#eventTrack').innerHTML = selected.events.map((event,index) => `<div class="event-col ${event.kind}"><i style="height:${18 + (event.address%7)*8}px"></i><small>${index+1}<br>L${event.address}</small></div>`).join('');
  const mshr = Math.min(100,Math.round(selected.maxOutstanding/16*100));
  const bandwidth = Math.min(100,Math.round(selected.issued/trace.length*100));
  const pollution = selected.issued ? Math.round(selected.unused/selected.issued*100) : 0;
  [['mshr',mshr,`${selected.maxOutstanding} / 16`],['bw',bandwidth,`${selected.issued} extra`],['pollution',pollution,`${pollution}%`]].forEach(([id,value,label]) => { $(`#${id}Meter`).style.width=`${value}%`; $(`#${id}Value`).textContent=label; });
}
$$('.config-card').forEach(card => {
  const degree = $('.cfg-degree',card), distance = $('.cfg-distance',card);
  degree.addEventListener('input',() => $('.cfg-degree-out',card).textContent=degree.value);
  distance.addEventListener('input',() => $('.cfg-distance-out',card).textContent=distance.value);
});
$('#simLatency').addEventListener('input',() => $('#simLatencyOut').textContent=`${$('#simLatency').value} cycles`);
$('#runSim').addEventListener('click',runSimulation);

// Chapter 05: DPC4 atlas. All descriptions summarize official final papers.
const dpcPapers = [
  {id:'vip',name:'VIP',subtitle:'Virtual inter-page',title:'Crossing the Boundary: Virtual-Address Based Inter-Page Prefetching for Lower Level Caches',target:'L1 observer → lower cache',signal:'VA L1D miss stream + IP',address:'Virtual observation, TLB-verified physical issue',control:'TLB permission/correctness check',multicore:'Not primary focus',problem:'PA 기반 L2 prefetcher는 보안과 translation 문제 때문에 4 KB 경계를 넘는 예측을 버린다. L1은 VA 연속성을 보지만 긴 lookahead가 부족하다.',idea:'L1D miss stream을 VA domain에서 관측하고 IP-correlated predictor로 inter-page stride를 학습한다. 예측 주소는 TLB lookup이 translation과 permission을 확인한 뒤 physical prefetch로 발행한다.',notice:'기존 L1/L2 predictor를 교체하지 않고 주소 공간 사이의 gap을 보완한다.',flow:['VA miss stream','IP predictor','page-cross target','TLB verify','PA request'],pdf:'VIP-final.pdf'},
  {id:'sppam',name:'SPPAM',subtitle:'Signature + access map',title:'Signature Pattern Prediction and Access-Map Prefetcher',target:'L2',signal:'Learned access-map patterns',address:'Physical region / access map',control:'Confidence-throttled lookahead',multicore:'Shared evaluation',problem:'SPP의 시간 순서 signature는 OoO core와 상위 cache의 재정렬에 민감하다. AMPM의 access map은 재정렬에 강하지만 한 region 밖으로 speculation하기 어렵다.',idea:'온라인으로 access-map pattern 집합을 학습하고 이를 signature-style speculative lookahead에 사용한다. confidence가 재귀 speculation을 제한한다.',notice:'시간적 path prediction과 공간적 bitmap의 장점을 결합한다.',flow:['region access map','online pattern learning','signature path','confidence gate','L2 request'],pdf:'SPPAM-final.pdf'},
  {id:'emender',name:'Emender',subtitle:'Priority + throttling',title:'Optimizing Prefetch Priority and Throttling in VBerti + Pythia',target:'L1/L2/L3 hierarchy',signal:'VBerti + Pythia candidates',address:'Virtual/physical hierarchy',control:'Priority, Cuckoo filter, dynamic confidence, fairness',multicore:'L3 fairness throttling',problem:'좋은 predictor도 중복 target과 낮은 우선순위 요청으로 자원을 낭비하고, multicore에서는 한 core의 prefetch가 다른 core를 방해한다.',idea:'Pending Target Buffer로 요청 우선순위를 정하고 Cuckoo Filter로 cached duplicate를 제거한다. load miss-rate로 confidence threshold를 조정하고 L3 feedback으로 core별 발행을 제한한다.',notice:'새 address predictor보다 후보를 관리하는 control plane을 전면에 둔다.',flow:['VBerti/Pythia','priority buffer','duplicate filter','dynamic confidence','fair issue'],pdf:'Emender-final.pdf'},
  {id:'sberti',name:'sBerti',subtitle:'Berti + smart stride',title:'Enhancing Berti with a Smart Stride Prefetcher for Better Coverage',target:'L1D (+ L2 Pythia)',signal:'Local delta + PC stride',address:'Cross-page capable',control:'Confidence and timeliness adaptive degree',multicore:'Evaluated in suite',problem:'Berti의 local delta timing은 효과적이지만 AI/ML workload에 나타나는 길고 단순한 streaming pattern을 충분히 공격적으로 따라가지 못한다.',idea:'Berti에 Smart Stride engine을 병렬로 추가한다. stride confidence와 prefetched line의 timeliness를 보고 degree를 조절하며 page boundary를 넘는다.',notice:'복잡한 pattern용 Berti와 단순 stream용 고-degree engine의 역할 분담을 본다.',flow:['PC stream','stride confidence','timeliness feedback','adaptive degree','cross-page request'],pdf:'sBerti-final.pdf'},
  {id:'bertigo',name:'BertiGO',subtitle:'Context + filtering',title:'Pushing the Limits of the Berti Prefetcher',target:'L1D + L2 + LLC',signal:'Berti delta + IP-path signature',address:'Virtual L1 context',control:'Region filter + set dueling',multicore:'Hierarchy policy adapts',problem:'Berti는 정확한 target도 cache에 이미 존재하면 반복 요청하고, 현재 IP만 key로 사용해 실행 경로가 다른 문맥을 구분하지 못한다.',idea:'Region bitmap filter가 redundant·useless request를 줄이고 IP-path signature가 context를 보강한다. L2 Pythia와 LLC next-line 정책은 set dueling으로 선택한다.',notice:'prediction quality와 hierarchy resource efficiency를 분리해 개선한다.',flow:['Berti target','IP-path context','region bitmap filter','policy duel','hierarchy issue'],pdf:'BertiGO-final.pdf'},
  {id:'edp',name:'EDP',subtitle:'Entangled triggers',title:'The Entangling Data Prefetcher',target:'L1D',signal:'Local deltas + trigger/target IP relation',address:'Cache-line delta',control:'PPQ queues + Bloom filter',multicore:'4-core evaluated',problem:'같은 IP가 예측과 발행을 모두 담당하면 zero-delta와 long-reuse에 늦고, trigger IP를 분리한 기존 방식은 복잡한 delta pattern을 놓칠 수 있다.',idea:'target pattern을 설명하는 IP와 더 일찍 등장하는 trigger IP를 entangle한다. local delta로 복잡한 pattern을 유지하고, request queue와 Bloom filter로 발행 자원을 관리한다.',notice:'“어디로”와 “언제부터”를 서로 다른 instruction이 담당한다.',flow:['target IP history','local delta','entangle trigger IP','early queue','filtered issue'],pdf:'EDP-final.pdf'},
  {id:'umama',name:'uMAMA',subtitle:'Bandit ensemble',title:'Performance-Driven Composite Prefetching with Bandits',target:'L1 Berti + L2 ensemble',signal:'Multiple predictor candidates + performance',address:'Expert-dependent',control:'Multi-armed bandit + Micro-MAMA',multicore:'Bandit-based fairness arbitration',problem:'accuracy·coverage 같은 low-level metric은 최종 성능과 상관관계가 workload와 system state에 따라 달라진다. 단일 predictor도 모든 pattern에 강할 수 없다.',idea:'storage budget을 여러 경량 predictor에 나누고 MAB agent가 proxy metric이 아니라 performance reward로 전문가를 선택한다. multicore에는 fairness arbitrator를 둔다.',notice:'predictor가 아니라 predictor portfolio를 online control하는 문제로 재정의한다.',flow:['expert ensemble','observe reward','bandit update','select policy','fair arbitration'],pdf:'uMAMA-final.pdf'},
  {id:'gberti',name:'gBerti',subtitle:'Streaming + spatial',title:'Global Berti: Simultaneous Streaming and Spatial Prefetching',target:'L1D',signal:'Berti table in two orientations',address:'Per-IP and cross-IP',control:'Shared table / low added cost',multicore:'Not primary focus',problem:'Berti는 한 instruction이 일정 delta로 만드는 stream은 찾지만 여러 instruction이 함께 만드는 spatial pattern은 놓친다.',idea:'Berti table을 IP 방향과 address 방향으로 조회한다. 같은 metadata를 두 관점에서 읽어 per-IP stream과 cross-IP spatial relation을 동시에 찾는다.',notice:'큰 새 구조 대신 기존 table의 조회 방향을 바꿔 관측 범위를 넓힌다.',flow:['Berti table','IP-oriented lookup','address-oriented lookup','merge predictions','L1D issue'],pdf:'GBerti-final.pdf'}
];
function paperById(id) { return dpcPapers.find(paper => paper.id === id); }
function renderPaper(id) {
  const paper = paperById(id);
  $$('#dpcList button').forEach(button => button.classList.toggle('active',button.dataset.paper===id));
  $('#dpcDetail').innerHTML = `<span class="paper-tag">${paper.target.toUpperCase()}</span><h3>${paper.name}</h3><p class="paper-title">${paper.title}</p><h4>기존 설계가 놓친 것</h4><p>${paper.problem}</p><h4>핵심 메커니즘</h4><p>${paper.idea}</p><div class="paper-flow">${paper.flow.map((step,index)=>`${index?'<i>→</i>':''}<span>${step}</span>`).join('')}</div><h4>읽을 때 주목할 점</h4><p>${paper.notice}</p><div class="paper-facts"><div><span>SIGNAL</span><b>${paper.signal}</b></div><div><span>ADDRESS</span><b>${paper.address}</b></div><div><span>CONTROL</span><b>${paper.control}</b></div></div><a class="paper-link" href="https://github.com/CMU-SAFARI/DPC4/blob/main/final-versions/${paper.pdf}" target="_blank" rel="noreferrer">Official final paper ↗</a>`;
}
$('#dpcList').innerHTML = dpcPapers.map((paper,index)=>`<button data-paper="${paper.id}" class="${index===0?'active':''}"><i>${String(index+1).padStart(2,'0')}</i><span><b>${paper.name}</b><small>${paper.subtitle}</small></span></button>`).join('');
$('#dpcList').addEventListener('click',event=>{const button=event.target.closest('button');if(button)renderPaper(button.dataset.paper);});
renderPaper('vip');

const compareFields = [['Target','target'],['Prediction signal','signal'],['Address domain','address'],['Adaptive control','control'],['Multicore','multicore'],['Design lens','notice']];
function renderCompare() {
  const a=paperById($('#compareA').value), b=paperById($('#compareB').value);
  $('#compareTable').innerHTML=`<div class="row-label head">QUESTION</div><div class="head">${a.name}</div><div class="head">${b.name}</div>`+compareFields.map(field=>`<div class="row-label">${field[0]}</div><div>${a[field[1]]}</div><div>${b[field[1]]}</div>`).join('');
}
['compareA','compareB'].forEach((id,index)=>{ $(`#${id}`).innerHTML=dpcPapers.map((paper,i)=>`<option value="${paper.id}" ${i===index?'selected':''}>${paper.name}</option>`).join(''); $(`#${id}`).addEventListener('change',renderCompare); });
renderCompare();

// Chapter 06: exact repository commands and stats
const codeExamples = {
  baseline: `cd GEM5
./build/RISCV/gem5.opt \\
  -d ../2_prefetch/results/no_pf \\
  ./configs/example/kmhv3.py \\
  --raw-cpt \\
  --generic-rv-cpt=./ready-to-run/coremark-2-iteration.bin \\
  --maxinsts=10000000 \\
  --warmup-insts-no-switch=1000000 \\
  --no-pf`,
  enabled: `cd GEM5
./build/RISCV/gem5.opt \\
  -d ../2_prefetch/results/default_pf \\
  ./configs/example/kmhv3.py \\
  --raw-cpt \\
  --generic-rv-cpt=./ready-to-run/coremark-2-iteration.bin \\
  --maxinsts=10000000 \\
  --warmup-insts-no-switch=1000000`,
  stats: `# IPC와 prefetcher formula/count를 같은 표본에서 비교
for run in no_pf default_pf; do
  echo "=== $run ==="
  grep -E 'cpu\.ipc|prefetcher\.(pfIssued|pfUseful|pfUnused|pfLate|pfFiltered|accuracy|coverage)' \\
    ../2_prefetch/results/$run/stats.txt
done

# page-crossing 효과가 필요하면 추가 확인
grep -E 'pfSpanPage|pfUsefulSpanPage' \\
  ../2_prefetch/results/default_pf/stats.txt`
};
function showCode(key) { $('#codePanel').textContent=codeExamples[key]; $$('.terminal-tabs [data-code]').forEach(button=>button.classList.toggle('active',button.dataset.code===key)); }
$('.terminal-tabs [role="tablist"]').addEventListener('click',event=>{const button=event.target.closest('button');if(button)showCode(button.dataset.code);});
$('#copyCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#codePanel').textContent);$('#copyCode').textContent='복사됨';setTimeout(()=>$('#copyCode').textContent='복사',1200);}catch{$('#copyCode').textContent='선택해 복사';}});
showCode('baseline');

(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const profiles = {
    sequential: { baseIpc: 1.10, miss: 0.48, predict: 0.93, traffic: 0.72 },
    strided:    { baseIpc: 1.03, miss: 0.54, predict: 0.78, traffic: 0.80 },
    random:     { baseIpc: 0.82, miss: 0.72, predict: 0.20, traffic: 1.02 },
    indirect:   { baseIpc: 0.74, miss: 0.79, predict: 0.10, traffic: 1.10 }
  };

  const stageCopy = {
    cpu: "CPU가 load를 발행합니다. 프로그램은 이 데이터가 돌아올 때까지 독립적인 일을 계속 찾습니다.",
    cache: "L1/L2 lookup이 miss이면 아직 진행 중인 같은 block 요청이 있는지 확인합니다.",
    mshr: "MSHR는 아직 돌아오지 않은 cache block과 그 응답을 기다리는 요청을 기록합니다.",
    llc: "LLC hit이면 DRAM까지 가지 않고 fill이 돌아옵니다. miss이면 요청은 더 아래로 내려갑니다.",
    noc: "NoC에서 demand와 prefetch가 링크와 queue를 공유합니다. traffic이 많으면 injection stall이 생깁니다.",
    mc: "Memory controller는 read/write 요청을 스케줄링합니다. queue wait와 service time을 분리해 봅니다.",
    dram: "DDR은 bank와 row 상태에 따라 요청을 처리합니다. bandwidth 포화와 row conflict가 지연을 키울 수 있습니다."
  };

  const life = {
    allocate: ["ALLOCATE", "주소와 요청자를 한 칸에 기록합니다", "cache lookup이 miss이면 빈 MSHR entry를 찾습니다. 빈 칸이 없다면 demand는 하위 계층으로 나가지 못하고 기다립니다.", "0x10C0", "ALLOCATED"],
    merge: ["MERGE", "같은 block 요청은 한 miss에 합칩니다", "이미 진행 중인 block을 다시 읽으면 새 memory request를 만들지 않고 기존 entry의 target 목록에 요청자를 추가할 수 있습니다.", "0x10C0", "2 TARGETS"],
    wait: ["WAIT", "응답을 기다리는 동안 entry를 유지합니다", "LLC, NoC, memory controller, DDR을 지나는 동안 MSHR 한 칸은 계속 점유됩니다. Prefetch도 같은 자원을 사용할 수 있습니다.", "0x10C0", "IN SERVICE"],
    fill: ["FILL", "데이터를 전달하고 entry를 해제합니다", "fill이 도착하면 cache block을 갱신하고 병합된 요청자에게 응답합니다. 마지막 응답까지 끝나면 entry를 다시 사용할 수 있습니다.", "0x10C0", "RELEASED"]
  };

  const state = { pattern: "sequential", mshr: 8, degree: 4, tick: 0, running: true };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timer = null;

  function calculate() {
    const p = profiles[state.pattern];
    const degreeFactor = state.degree === 0 ? 0 : 1 - Math.exp(-state.degree / 2.2);
    const accuracy = state.degree === 0 ? 0 : Math.max(0.04, p.predict * (1 - Math.max(0, state.degree - 1) * 0.045));
    const coverage = degreeFactor * p.predict;
    const demandEntries = 1.2 + p.miss * 6.6;
    const pfEntries = state.degree === 0 ? 0 : (0.45 + state.degree * 0.63) * (0.55 + p.traffic * 0.5);
    const rawEntries = demandEntries + pfEntries;
    const occupancy = Math.min(1, rawEntries / state.mshr);
    const pressure = Math.max(0, rawEntries / state.mshr - 0.72);
    const traffic = 1 + state.degree * 0.105 * p.traffic;
    const bandwidthPenalty = Math.max(0, traffic - 1.48) * (0.36 + p.traffic * 0.16);
    const stall = Math.max(0.4, p.miss * 10.5 * (1 - coverage * 0.52) + pressure * 9.5 + bandwidthPenalty * 8);
    const ipc = Math.max(0.3, p.baseIpc * (1 + coverage * 0.26) * (1 - Math.min(0.48, pressure * 0.24 + bandwidthPenalty)));
    const used = Math.max(1, Math.min(state.mshr, Math.round(rawEntries)));
    const demand = Math.max(1, Math.min(used, Math.round(demandEntries)));
    const merged = Math.min(demand, Math.round(coverage * 2));
    return { ipc, occupancy, stall, accuracy, traffic, used, demand, merged };
  }

  function render() {
    const r = calculate();
    $("#metric-ipc").textContent = r.ipc.toFixed(2);
    $("#metric-occ").textContent = Math.round(r.occupancy * 100) + "%";
    $("#metric-stall").textContent = r.stall.toFixed(1);
    $("#metric-accuracy").textContent = state.degree ? Math.round(r.accuracy * 100) + "%" : "–";
    $("#metric-traffic").textContent = r.traffic.toFixed(2) + "×";
    $("#occupancy-label").textContent = r.used + " / " + state.mshr + " entries";

    const slots = $("#slots");
    slots.innerHTML = "";
    for (let i = 0; i < state.mshr; i += 1) {
      const slot = document.createElement("span");
      slot.className = "slot";
      let label = "빈 entry";
      if (i < r.used) {
        if (i < r.merged) { slot.classList.add("merge"); label = "병합된 demand"; }
        else if (i < r.demand) { slot.classList.add("demand"); label = "demand miss"; }
        else { slot.classList.add("prefetch"); label = "prefetch miss"; }
      }
      slot.title = label;
      slot.setAttribute("aria-label", (i + 1) + "번: " + label);
      slots.appendChild(slot);
    }
  }

  function selectSegment(group, value) {
    $$(`[data-control="${group}"] button`).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.value === String(value)));
    });
  }

  function advance() {
    state.tick = (state.tick + 1) % 7;
    const stages = $$(".request-path button");
    stages.forEach((button, index) => button.classList.toggle("hot", index === state.tick));
    const active = stages[state.tick];
    $("#stage-caption").textContent = stageCopy[active.dataset.stage];
    render();
  }

  function setRunning(running) {
    state.running = running;
    $("#run-toggle").textContent = running ? "일시정지" : "계속 실행";
    $("#sim-status").textContent = running ? "자동 실행 중" : "일시정지됨";
    if (timer) window.clearInterval(timer);
    timer = running ? window.setInterval(advance, 1500) : null;
  }

  function setupSimulator() {
    $("#pattern").addEventListener("change", (event) => { state.pattern = event.target.value; render(); });
    $$('[data-control="mshr"] button').forEach((button) => button.addEventListener("click", () => {
      state.mshr = Number(button.dataset.value); selectSegment("mshr", state.mshr); render();
    }));
    $$('[data-control="degree"] button').forEach((button) => button.addEventListener("click", () => {
      state.degree = Number(button.dataset.value); selectSegment("degree", state.degree); render();
    }));
    $$(".request-path button").forEach((button, index) => button.addEventListener("click", () => {
      state.tick = index; $$(".request-path button").forEach((item, i) => item.classList.toggle("hot", i === index));
      $("#stage-caption").textContent = stageCopy[button.dataset.stage];
    }));
    $("#run-toggle").addEventListener("click", () => setRunning(!state.running));
    $("#step").addEventListener("click", () => { setRunning(false); advance(); });
    $("#reset").addEventListener("click", () => {
      Object.assign(state, { pattern: "sequential", mshr: 8, degree: 4, tick: 0 });
      $("#pattern").value = state.pattern; selectSegment("mshr", 8); selectSegment("degree", 4);
      $("#stage-caption").textContent = stageCopy.mshr; setRunning(!reduceMotion); render();
    });
    render(); setRunning(!reduceMotion);
  }

  function setupLifecycle() {
    const tabs = $$('[data-life]');
    tabs.forEach((button, index) => button.addEventListener("click", () => {
      $$('[data-life]').forEach((item) => item.setAttribute("aria-selected", String(item === button)));
      const item = life[button.dataset.life];
      $("#life-kicker").textContent = item[0]; $("#life-title").textContent = item[1];
      $("#life-copy").textContent = item[2]; $("#life-block").textContent = item[3]; $("#life-state").textContent = item[4];
      $("#life-panel").focus({ preventScroll: true });
    }));
    tabs.forEach((button, index) => button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key)) return;
      event.preventDefault();
      const direction = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1;
      tabs[(index + direction + tabs.length) % tabs.length].focus();
    }));
  }

  function setupPage() {
    $("#theme-toggle").addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("mshr-theme", document.documentElement.dataset.theme); } catch (e) {}
    });
    window.addEventListener("scroll", () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      $("#read-progress").style.width = (max > 0 ? scrollY / max * 100 : 0) + "%";
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.running && timer) { window.clearInterval(timer); timer = null; }
      else if (!document.hidden && state.running && !timer) timer = window.setInterval(advance, 1500);
    });
  }

  setupPage(); setupSimulator(); setupLifecycle();
})();

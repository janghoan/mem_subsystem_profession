# Prefetch–Memory System 실험 계획

## 1. 실험 목적

본 실험의 목적은 prefetcher가 단순히 cache miss를 줄이는 수준을 넘어, **MSHR, LLC, NoC, Memory Controller, DDR 자원에 어떤 영향을 주는지 정량적으로 분석**하는 것이다.

특히 다음 질문에 답하는 것을 목표로 한다.

* Prefetch가 성능을 높일 때 실제 원인은 무엇인가?
* Prefetch가 MSHR를 얼마나 점유하며 demand miss를 방해하는가?
* MSHR가 여유로운데도 성능이 나빠지는 경우 downstream의 병목은 어디인가?
* Prefetch traffic이 DDR bandwidth, queueing latency, bank/row locality에 어떤 영향을 주는가?
* 시스템 상태에 따라 prefetch를 throttle하면 성능과 효율이 개선되는가?
* gem5에서 발견된 정책이 실제 RTL 구조에서도 구현 가능한가?

---

## 2. 전체 실험 흐름

```text
Phase 1
MSHR × Prefetch 기본 특성 분석
        ↓
Phase 2
LLC / NoC / Memory Controller 병목 분석
        ↓
Phase 3
DDR bandwidth / queue / bank 분석
        ↓
Phase 4
System-aware Prefetch Throttling
        ↓
Phase 5
RTL 구현 및 cycle-level 검증
```

1차 실험은 **gem5**를 사용한다.

gem5에서는 다양한 파라미터를 빠르게 sweep하면서 병목의 원인을 찾고, 이후 의미 있는 정책만 RTL에 구현한다.

---

# 3. Phase 1 — MSHR와 Prefetch 관계 분석

## 3.1 목적

Prefetch request가 MSHR를 점유하면서 demand request와 어떻게 경쟁하는지 확인한다.

핵심 질문은 다음과 같다.

> Prefetcher가 생성한 additional memory-level parallelism이 성능 향상으로 연결되는가, 아니면 MSHR pressure를 증가시켜 demand를 방해하는가?

---

## 3.2 실험 변수

### MSHR 개수

```text
4
8
16
32
```

### Prefetch 설정

```text
Prefetch OFF

Prefetch ON
 degree = 1
 degree = 2
 degree = 4
 degree = 8
```

가능하면 현재 사용 가능한 SPP 또는 Bingo 계열 prefetcher를 우선 사용한다.

---

## 3.3 기본 실험 Matrix

| Case | MSHR | Prefetch | Degree |
| ---- | ---: | -------- | -----: |
| A    |    8 | OFF      |      - |
| B    |    8 | ON       |      1 |
| C    |    8 | ON       |      2 |
| D    |    8 | ON       |      4 |
| E    |    8 | ON       |      8 |
| F    |    4 | ON       |      4 |
| G    |   16 | ON       |      4 |
| H    |   32 | ON       |      4 |

처음부터 모든 조합을 실행하기보다는 위 조합부터 실행한다.

---

## 3.4 측정 항목

### 성능

* IPC
* execution time
* MPKI
* average memory access latency

### MSHR

* average MSHR occupancy
* maximum occupancy
* occupancy histogram
* MSHR full cycles
* MSHR allocation failure
* demand MSHR allocation stall

### Prefetch

* issued prefetch
* useful prefetch
* useless prefetch
* late prefetch
* redundant prefetch
* demand–prefetch merge
* prefetch accuracy
* coverage

---

## 3.5 예상 분석

예를 들어 다음과 같은 결과가 나올 수 있다.

```text
PF OFF

IPC                1.00
MSHR occupancy     35%
MSHR full cycles   2%


PF Degree 4

IPC                1.12
MSHR occupancy     68%
MSHR full cycles   8%
```

이 경우 prefetch가 MSHR pressure를 높였지만 성능 향상이 더 크므로 긍정적인 결과다.

반대로

```text
PF Degree 8

IPC                1.06
MSHR occupancy     91%
MSHR full cycles   25%
```

라면 공격적인 prefetch가 오히려 demand request를 방해하고 있다고 판단할 수 있다.

---

# 4. Phase 2 — Downstream Contention 분석

MSHR만으로 전체 병목을 설명할 수 있는지 확인한다.

관찰 범위는 다음과 같다.

```text
CPU
 │
 ▼
L1 / L2
 │
 ▼
MSHR
 │
 ▼
LLC
 │
 ▼
NoC
 │
 ▼
Memory Controller
 │
 ▼
DDR
```

---

## 4.1 주요 측정 항목

### LLC

* LLC hit/miss
* request queue occupancy
* refill queue occupancy
* demand request latency
* prefetch request latency

### NoC

가능한 경우 다음을 측정한다.

* injection stall
* queue occupancy
* packet latency
* demand traffic
* prefetch traffic

### Memory Controller

* read queue occupancy
* write queue occupancy
* average queue waiting time
* demand request queue latency
* prefetch request queue latency

---

## 4.2 핵심 분석

다음과 같은 상태를 찾는 것이 중요하다.

```text
MSHR occupancy = 35%
MC queue        = 95%
```

이 경우 MSHR는 병목이 아니다.

Prefetch throttling을 MSHR만 보고 수행하면 시스템 상태를 잘못 판단할 수 있다.

반대로

```text
MSHR occupancy = 95%
MC queue        = 40%
```

라면 cache-side outstanding request capacity가 병목일 가능성이 높다.

---

# 5. Phase 3 — DDR 관점 분석

DDR 내부를 처음부터 세부 timing까지 분석하지 않는다.

다음 순서로 접근한다.

---

## 5.1 Step 1 — Bandwidth

먼저 다음만 확인한다.

* DRAM read bandwidth
* DRAM write bandwidth
* total bandwidth
* bandwidth utilization
* prefetch traffic 증가량

예:

```text
PF OFF

DRAM BW = 20 GB/s


PF ON

DRAM BW = 31 GB/s
IPC     = +3%
```

이 경우 prefetch가 55%의 additional traffic을 발생시키면서 성능은 3%밖에 향상시키지 못한다.

효율이 낮은 prefetch라고 볼 수 있다.

---

# 6. Step 2 — Memory Queueing Latency

Memory access latency를 다음처럼 분리한다.

```text
Memory latency

= Queue waiting time
+ DRAM service time
```

예:

```text
PF OFF

Queue wait     = 20 cycles
DRAM service   = 60 cycles

Total          = 80 cycles


PF ON

Queue wait     = 65 cycles
DRAM service   = 60 cycles

Total          = 125 cycles
```

이 경우 문제는 DDR timing 자체가 아니라 **prefetch traffic 때문에 발생한 queue congestion**이다.

---

# 7. Step 3 — Bank / Row Locality

다음으로 DRAM 내부 locality를 본다.

측정 후보:

* row-buffer hit
* row-buffer miss
* row-buffer conflict
* bank utilization
* bank-level parallelism
* ACT count
* PRE count

예:

```text
PF OFF

Row hit rate = 72%


PF ON

Row hit rate = 46%
```

이 경우 prefetch가 주소 자체는 맞게 예측하더라도 DRAM access ordering을 훼손하고 있을 가능성이 있다.

---

# 8. Phase 4 — Prefetch Throttling

병목을 확인한 뒤 간단한 system-aware controller를 추가한다.

처음에는 복잡한 ML 기반 정책보다 threshold 기반 정책으로 시작한다.

---

## 8.1 Baseline

```text
Always-on Prefetch
```

---

## 8.2 MSHR 기반

예:

```text
MSHR < 50%
    Degree = 4

50% ≤ MSHR < 75%
    Degree = 2

75% ≤ MSHR < 90%
    Degree = 1

MSHR ≥ 90%
    Prefetch OFF
```

---

## 8.3 Memory Controller 기반

```text
MC Queue < 50%
    Normal

MC Queue > 75%
    Reduce degree

MC Queue > 90%
    Disable low-confidence PF
```

---

## 8.4 Combined Policy

최종적으로 다음 구조를 비교한다.

```text
                MSHR occupancy
                     │
                     │
DRAM BW ─────────────┼──────── MC queue
                     │
                     ▼
             Prefetch Controller
                     │
          ┌──────────┼───────────┐
          ▼          ▼           ▼
       Degree     Priority      Enable
```

---

## 8.5 비교 대상

| Policy     | 설명                |
| ---------- | ----------------- |
| Baseline   | 항상 Prefetch       |
| MSHR-aware | MSHR occupancy 기반 |
| MC-aware   | Memory queue 기반   |
| BW-aware   | DRAM bandwidth 기반 |
| Combined   | 여러 signal 통합      |

---

# 9. Prefetch 효율 지표

Prefetcher의 성능은 accuracy 하나로 평가하지 않는다.

다음 지표를 함께 사용한다.

### Prediction quality

* Accuracy
* Coverage

### Timeliness

* Timely prefetch
* Late prefetch
* Demand merge

### Resource efficiency

* MSHR occupancy
* DRAM traffic
* Memory queue occupancy
* NoC traffic

### Side effect

* cache pollution
* demand latency increase
* row-buffer locality degradation

### 최종 성능

* IPC
* execution time

---

# 10. 추가로 계산하면 좋은 지표

단순 accuracy보다 다음 지표가 유용할 수 있다.

### Prefetch Traffic Efficiency

```text
Useful Prefetch
────────────────
Total Prefetch Traffic
```

### Performance per Traffic

```text
IPC Improvement
───────────────
Additional DRAM Traffic
```

예:

```text
SPP

IPC improvement = 10%
DRAM traffic     = +35%


Bingo

IPC improvement = 9%
DRAM traffic     = +15%
```

IPC만 보면 SPP가 우수하지만, memory-centric 관점에서는 Bingo가 더 효율적일 수 있다.

---

# 11. Workload

처음에는 성격이 다른 workload를 소수만 선택한다.

### Streaming

* STREAM
* sequential microbenchmark

### Regular

* stride access
* array traversal

### Irregular

* GAPBS
* graph workload
* random access

### Indirect / dependent

```c
A[index[i]]
```

또는

```c
node = node->next;
```

형태의 microbenchmark를 직접 작성하는 것도 좋다.

---

# 12. 추천 첫 실험

처음부터 대규모 benchmark를 돌리지 않는다.

다음 세 workload만 있어도 충분하다.

```text
W1 : Sequential streaming

W2 : Random access

W3 : Indirect access
     A[index[i]]
```

그리고

```text
MSHR = 8

PF OFF
PF Degree 1
PF Degree 4
PF Degree 8
```

을 먼저 비교한다.

---

# 13. 결과 그래프

첫 분석에서는 그래프를 너무 많이 만들지 않는다.

## Graph 1

```text
X = Prefetch Degree
Y = IPC
```

## Graph 2

```text
X = Prefetch Degree
Y = MSHR occupancy
```

## Graph 3

```text
X = Prefetch Degree
Y = DRAM bandwidth
```

## Graph 4

```text
X = Prefetch Degree
Y = Memory queue latency
```

## Graph 5

```text
X = Prefetch Degree
Y = Row-buffer hit rate
```

이 5개를 같이 보면 prefetch aggressiveness와 memory-system pressure의 관계가 상당히 명확하게 드러난다.

---

# 14. RTL 실험

gem5 실험 이후 의미 있는 정책만 RTL로 옮긴다.

RTL에서 우선 보고 싶은 구조는 다음과 같다.

```text
Demand Request ───────┐
                      │
Prefetch Request ─────┤
                      ▼
                   Arbiter
                      │
                Miss / Req Queue
                      │
                     LLC
                      │
                     NoC
```

---

## 14.1 RTL에서 추가할 Counter

### Request

* demand request count
* prefetch request count

### Arbitration

* demand wait cycles
* prefetch wait cycles
* arbiter conflict count

### Queue

* queue occupancy
* queue full cycles

### MSHR

* average occupancy
* full cycles
* demand allocation fail
* PF allocation fail

### Prefetch

* issued
* dropped
* throttled

---

# 15. RTL에서 비교할 간단한 정책

### Case 1

```text
Round Robin
```

### Case 2

```text
Demand Priority
```

### Case 3

```text
Prefetch Outstanding Limit
```

예:

```text
Maximum Prefetch Outstanding = 4
```

### Case 4

```text
MSHR-aware Prefetch Blocking
```

예:

```text
if MSHR > 75%
    block prefetch
```

이 정도만 구현해도 실제 하드웨어에서 prefetch와 demand가 자원을 어떻게 경쟁하는지 명확하게 볼 수 있다.

---

# 16. gem5와 RTL의 역할 구분

## gem5

목적:

> **어떤 정책이 좋은가?**

적합한 작업:

* parameter sweep
* workload 비교
* MSHR sweep
* prefetch degree sweep
* memory configuration 변경
* throttling policy 탐색

---

## RTL

목적:

> **그 정책이 실제 hardware structure에서 어떻게 동작하는가?**

적합한 작업:

* arbitration
* backpressure
* cycle-level stall
* queue depth
* hardware counter
* implementation complexity
* timing / area overhead

따라서 연구 순서는 다음이 가장 효율적이다.

```text
gem5 exploration
      ↓
병목 발견
      ↓
Policy 설계
      ↓
gem5 검증
      ↓
RTL 구현
      ↓
Cycle-level 검증
```

---

# 17. HERALD 확장 시 활용

이 실험 환경은 이후 HERALD 분석에도 그대로 사용할 수 있다.

HERALD의 경우 특히 다음을 분리해서 측정할 수 있다.

```text
Producer Store
      ↓
Early Candidate
      ↓
Freshness Check
      ↓
Prefetch Issue
      ↓
Memory System
```

측정할 항목:

* generated candidate
* freshness validation pass/fail
* stale candidate
* issued prefetch
* late prefetch
* MSHR occupancy
* MC queue pressure
* DRAM traffic
* demand interference

핵심 질문은 다음과 같다.

> HERALD의 early triggering이 실제 latency hiding으로 연결되는가?

그리고 동시에:

> 더 일찍 생성된 request가 downstream resource pressure를 증가시키지는 않는가?

---

# 18. 최종적으로 얻고 싶은 그림

최종 목표는 단순히

```text
SPP IPC = X
Bingo IPC = Y
HERALD IPC = Z
```

를 얻는 것이 아니다.

다음과 같은 설명이 가능해야 한다.

```text
Prefetch aggressiveness 증가
        ↓
Coverage 증가
        ↓
MSHR occupancy 증가
        ↓
Memory queue 증가
        ↓
DDR contention 증가
        ↓
Demand latency 증가
        ↓
어느 지점 이후 IPC 감소
```

그리고 최종적으로:

```text
Workload behavior
       ↓
Prefetch prediction
       ↓
Cache resource pressure
       ↓
NoC / Memory pressure
       ↓
DDR behavior
       ↓
System performance
```

라는 전체 인과관계를 설명할 수 있어야 한다.

---

# 19. 첫 번째 실행 단위

처음에는 아래 실험만 수행한다.

### Configuration

```text
MSHR = 8

PF OFF
PF Degree = 1
PF Degree = 4
PF Degree = 8
```

### Workload

```text
Sequential
Random
Indirect
```

### 반드시 수집할 값

```text
IPC

MSHR occupancy
MSHR full cycles

PF issued
PF useful
PF late

DRAM bandwidth
Memory queue latency
Row-buffer hit rate
```

이 결과를 먼저 확보한 뒤 다음 실험 변수를 추가한다.

---

# 20. 연구 진행 기준

첫 실험에서 가장 먼저 찾을 것은 **최고 성능 configuration이 아니다.**

찾아야 하는 것은 다음 세 가지다.

1. **Prefetch가 언제 도움이 되는가**
2. **어느 resource가 먼저 포화되는가**
3. **어느 시점부터 prefetch가 demand를 방해하는가**

이 세 가지가 보이면 이후의 adaptive prefetching, HERALD resource control, memory-centric data movement 연구로 자연스럽게 확장할 수 있다.


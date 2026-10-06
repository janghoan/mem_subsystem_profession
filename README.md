# Memory Subsystem Profession

XS-GEM5를 사용해 prefetch와 MSHR, LLC, NoC, memory controller 및 DDR 병목을 분석하는 연구 저장소다. 실험 계획은 [`1_mshr/exp_plan.md`](1_mshr/exp_plan.md)에 있으며, 수정된 XS-GEM5는 [`GEM5/`](GEM5/) submodule로 관리한다.

## Repository Layout

- `1_mshr/`: MSHR/prefetch 실험 계획과 로컬 실행 결과
- `2_prefetch/`: prefetch ON/OFF baseline 실험 지침과 로컬 결과
- `docs/`: MSHR와 prefetch 관계를 설명하는 인터랙티브 교재
- `prefetcher-lab/`: prefetch 기초와 DPC4 설계를 다루는 인터랙티브 교재
- `GEM5/`: `janghoan/mem_sys_GEM5`의 `xs-dev` 브랜치를 사용하는 submodule
- `AGENTS.md`: 저장소 개발 및 검증 지침

`1_mshr/results/`와 GEM5 빌드 산출물은 Git에 포함되지 않는다.

## Interactive Guide

[MSHR Lab](https://mshr-lab.janghoan.chatgpt.site)은 접근 패턴, MSHR 수, prefetch degree를 바꾸며 요청 흐름과 resource pressure를 살펴보는 인터랙티브 설명 자료다. 표시되는 simulator 값은 관계를 설명하기 위한 개념 모델이며 실제 gem5 측정값이 아니다.

로컬에서는 다음과 같이 실행한다.

```bash
python3 -m http.server 8000 --directory docs/dist
```

### Prefetcher Lab

[Prefetcher Lab](https://prefetcher-lab.janghoan.chatgpt.site)은 latency timeline,
주소 예측 연습, predictor 구조, event 기반 A/B 실험을 통해 accuracy, coverage,
timeliness 및 resource pressure를 설명한다. DPC4(HPCA 2026)의 8개 공식 제출작을
동일한 기준으로 비교하고, XS-GEM5 baseline 실험으로 이어진다.

```bash
python3 -m http.server 8001 --directory prefetcher-lab/dist
```

## Clone

새 머신에서는 submodule을 함께 clone한다.

```bash
git clone --recurse-submodules \
  https://github.com/janghoan/mem_subsystem_profession.git
cd mem_subsystem_profession
git -C GEM5 switch xs-dev
```

이미 일반 clone을 했다면 다음을 실행한다.

```bash
git submodule update --init --recursive
git -C GEM5 switch xs-dev
```

원본 XS-GEM5의 변경을 가져오려면 upstream remote도 등록한다.

```bash
git -C GEM5 remote add upstream \
  https://github.com/OpenXiangShan/GEM5.git
```

## Host Dependencies

Ubuntu 24.04 기준으로 다음 패키지를 설치한다.

```bash
sudo apt update
sudo apt install -y \
  build-essential git cmake wget m4 scons \
  zlib1g zlib1g-dev python3-dev \
  libprotobuf-dev protobuf-compiler libprotoc-dev \
  libgoogle-perftools-dev libboost-all-dev \
  pkg-config libsqlite3-dev zstd libzstd-dev
```

## Build XS-GEM5

모든 명령은 `GEM5/`에서 실행한다. `init.sh`는 DRAMSim3를 clone하고 빌드하므로 새 checkout에서 한 번만 실행한다.

```bash
cd GEM5
bash init.sh
scons build/RISCV/gem5.opt --gold-linker -j8
```

첫 빌드에서 Git hook 설치 여부를 물으면 Enter를 눌러 계속한다.

## Prepare the Workload and Reference Model

CoreMark checkpoint와 NEMU reference model은 별도로 내려받는다.

```bash
git clone https://github.com/OpenXiangShan/ready-to-run.git
wget \
  https://github.com/OpenXiangShan/GEM5/releases/download/2024-10-16/riscv64-nemu-interpreter-c1469286ca32-so
```

시뮬레이션을 실행할 터미널마다 환경 변수를 설정한다.

```bash
export GEM5_HOME="$PWD"
export GCBV_REF_SO="$PWD/riscv64-nemu-interpreter-c1469286ca32-so"
```

## Smoke Test

다음 명령은 `kmhv3.py`, DRAMSim3, NEMU difftest 조합으로 10,000개 명령을 실행한다.

```bash
./build/RISCV/gem5.opt \
  -d ../1_mshr/results/setup_smoke \
  ./configs/example/kmhv3.py \
  --raw-cpt \
  --generic-rv-cpt=./ready-to-run/coremark-2-iteration.bin \
  --maxinsts=10000 \
  --warmup-insts-no-switch=0
```

정상 종료 후 주요 통계를 확인한다.

```bash
grep -E 'simInsts|cpu.ipc' \
  ../1_mshr/results/setup_smoke/stats.txt
```

## Updating the GEM5 Submodule

GEM5 소스 변경과 최상위 submodule 포인터는 각각 commit하고 push해야 한다.

```bash
cd GEM5
git add <files>
git commit -m "mem-cache: Describe change"
git push origin xs-dev

cd ..
git add GEM5
git commit -m "Update GEM5 submodule"
git push origin main
```

새 머신에서 push하려면 먼저 GitHub 인증을 구성한다.

```bash
gh auth login -h github.com -p https -w
```

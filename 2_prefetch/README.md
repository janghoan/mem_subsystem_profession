# Prefetcher Baseline Experiment

Prefetcher Lab의 첫 실험은 동일한 checkpoint에서 XS-GEM5 기본 prefetch hierarchy와
`--no-pf` baseline을 비교한다. 두 실행은 checkpoint, warmup, instruction budget을
동일하게 유지해야 한다.

```bash
cd GEM5

./build/RISCV/gem5.opt -d ../2_prefetch/results/no_pf \
  ./configs/example/kmhv3.py --raw-cpt \
  --generic-rv-cpt=./ready-to-run/coremark-2-iteration.bin \
  --maxinsts=10000000 --warmup-insts-no-switch=1000000 --no-pf

./build/RISCV/gem5.opt -d ../2_prefetch/results/default_pf \
  ./configs/example/kmhv3.py --raw-cpt \
  --generic-rv-cpt=./ready-to-run/coremark-2-iteration.bin \
  --maxinsts=10000000 --warmup-insts-no-switch=1000000
```

결과에서는 IPC만 보지 말고 `pfIssued`, `pfUseful`, `pfUnused`, `pfLate`,
`pfFiltered`, `accuracy`, `coverage`를 함께 기록한다. 이 통계는 현재 checkout의
`GEM5/src/mem/cache/prefetch/base.cc`에서 정의된다.

```bash
grep -E 'cpu\.ipc|prefetcher\.(pfIssued|pfUseful|pfUnused|pfLate|pfFiltered|accuracy|coverage)' \
  2_prefetch/results/{no_pf,default_pf}/stats.txt
```

`results/`는 생성 데이터이므로 Git에서 제외한다. 실험 보고에는 정확한 commit,
checkpoint, 명령, 종료 원인과 두 실행의 통계 표를 남긴다.

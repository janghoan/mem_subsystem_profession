# Repository Guidelines

## Project Structure & Module Organization

This workspace combines research planning with a nested XS-GEM5 checkout. `1_mshr/exp_plan.md` defines the prefetch/MSHR experiment phases and measurements. Simulator work lives in `GEM5/`: core C++ and Python code is under `src/`, runnable configurations under `configs/`, regression tests under `tests/`, utilities under `util/`, and design notes under `docs/`. Small RISC-V stress programs live in `GEM5/microbench/`. Read `GEM5/ARCHITECTURE.md` before changing CPU, cache, or configuration boundaries, and follow the more detailed `GEM5/AGENTS.md` for work inside that checkout.

## Build, Test, and Development Commands

Run simulator commands from `GEM5/`:

- `scons build/RISCV/gem5.opt --gold-linker -j8` builds the optimized RISC-V simulator.
- `scons build/RISCV/gem5.debug --gold-linker -j8 --debug-cycle` builds a debug binary with cycle-tagged diagnostics.
- `scons build/RISCV/unittests.opt -j8 --unit-test` builds the unit-test suite.
- `cd tests && ./main.py run --length quick --variant opt --isa RISCV` runs the quick RISC-V regression set.
- `make -C microbench` cross-compiles all `.c` and `.s` microbenchmarks; a RISC-V GNU toolchain is required.
- `pre-commit run --all-files` applies repository-wide hygiene and Python formatting checks.

## Coding Style & Naming Conventions

Use four spaces and no tabs. Format C/C++ with `clang-format` using `GEM5/.clang-format` (119-column limit); format Python with Black (79-column limit). Follow nearby code and the nested guide: `UpperCamelCase` for types, `lower_snake_case` for functions and methods, and `ALL_CAPS` for constants. Keep comments and commit messages in English. Avoid mixing unrelated cleanup with experiment or simulator changes.

## Testing Guidelines

Add focused tests near the affected subsystem; Python test entry points conventionally use `test_*.py`. Run the smallest relevant unit or regression test first, then the quick RISC-V suite for cross-cutting changes. For cache, prefetch, timing, or BPU changes, report the workload/configuration plus key statistics or checkpoint-regression results. State explicitly when required checkpoints or reference-model paths prevent full validation.

## Commit & Pull Request Guidelines

Recent history favors imperative, area-prefixed subjects, for example `mem-cache: Fix duplicated L2 issue counters`. Keep each commit to one logical change. Pull requests should explain motivation, approach, affected configurations, and exact validation commands/results; link an issue when applicable. Include before/after performance data for behavior or timing changes and update relevant design or experiment documentation.

# 5G4Data intent-generation evaluation (V2)

These experiments compare recipes for turning an operator request in natural (ordinary) language into a TM Forum formatted 5G4Data **intent**: a structured graph the platform can store, validate, and act on. Each recipe (a **cell**) turns one knob—weights, system instructions, few-shot examples, temperature, grounding, or post-processing—and is scored on the same held-out requests for semantic match, schema validity, and structural completeness. 

The experiment design is in [EXPERIMENT.md](EXPERIMENT.md). The description of the experiment cell matrix is in [CELLS.md](CELLS.md). The latest evaluation run (Qwen 3.8 27B, 2026-08-26) is summarised in [results/20260826_185205_qwen3.8-27b/SUMMARY.md](results/20260826_185205_qwen3.8-27b/SUMMARY.md).
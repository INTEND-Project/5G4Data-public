# Default cell matrix

Executable recipes live in [`cells.yaml`](cells.yaml). Default `--limit 20`. Full factorial is too large; this set is enough to pick a production recipe. `--cells` selects a subset; extra recipes can be added in YAML.

Non-technical description of the same experiment: [`EXPERIMENT.md`](EXPERIMENT.md). Scoring: [`SCORING.md`](SCORING.md). Names: [`NAMES.md`](NAMES.md).

## Factors

Each default cell turns one (or a small, documented pair of) knobs. Construction that is baked into the Ollama Modelfile appears in the Ollama name; user style and postprocessing do not.

- **weights:** `stock` vs `fine-tuned` (in Ollama name)
- **SYSTEM:** `short` vs `long` (in Ollama name)
- **few-shots:** `none` vs `net-dep-both` (in Ollama name) — the three shared pairs `fewshot_{net,dep,both}_{user.txt,asst.ttl}`
- **PARAMETER:** `temp-0`, `temp-0.1`, `temp-0.7` baked as `PARAMETER temperature` (in Ollama name); `num_ctx=16384` and `num_predict=8192` on all (override with `NUM_CTX` / `NUM_PREDICT` or `--num-ctx` / `--num-predict` on setup; recreate the Ollama name with `--force` after changing them). Optional `-param-27b` if that extra sampling block is used
- **user:** `user-grounded` vs `user-notgrounded` — **cell id only**, not `ollama list`
- **postprocessing:** optional `_postprocessing` suffix — **cell id only**. Applied only for that cell, **before** structure / NL / dual SHACL scoring. Other cells score raw model Turtle (fence stripping only)

### Postprocessing steps (that cell only)

Order in [`lib/postprocess.py`](lib/postprocess.py):

1. Pad typed locals that have 8–31 hex digits after `I|DE|NE|SE|CE|RE|CO|CX|RG` to 32 hex
2. Remint typed locals copied from `prompts/fewshot_*_asst.ttl` (including compound names such as `latency_CO…` / `member_CO…`)
3. Uniquify uuid4 hex reused under two type prefixes
4. Rewrite `data5g:DataCenter` literals from Grounding JSON / `meta.data_center` when the value is `EC_*`
5. Agent uuidFix, required prefixes, and the other live-agent postprocessors (not SHACL)

`--skip-generate` re-scores existing `predictions.jsonl` and applies this pipeline again (idempotent except for new uuid4s on remint/uniquify). Dual SHACL always validates the Turtle that was scored; it does **not** apply uuidFix as a scoring side effect on the other nine cells.

## Default cells

Ten cells, **seven** Ollama names. Names overlap **only** when the serve object is the same and solely the user message or eval postprocess differs.

| Cell id | Ollama model (`ollama list`) | User | What it isolates |
|---|---|---|---|
| `fine-tuned_sys-short_fewshot-none_temp-0.1_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-short-fewshot-none-temp-0.1` | `user-grounded` | Fine-tuned baseline (short SYSTEM, no shots, temp 0.1) |
| `stock_sys-short_fewshot-none_temp-0.1_user-grounded` | `5g4data-<model_tag>-stock-sys-short-fewshot-none-temp-0.1` | `user-grounded` | Same recipe on stock weights |
| `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-long-fewshot-net-dep-both-temp-0.1` | `user-grounded` | Long SYSTEM + three few-shots, raw Turtle |
| `fine-tuned_sys-short_fewshot-net-dep-both_temp-0.1_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-short-fewshot-net-dep-both-temp-0.1` | `user-grounded` | Few-shots with short SYSTEM |
| `fine-tuned_sys-long_fewshot-none_temp-0.1_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-long-fewshot-none-temp-0.1` | `user-grounded` | Long SYSTEM without few-shots |
| `fine-tuned_sys-short_fewshot-none_temp-0_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-short-fewshot-none-temp-0` | `user-grounded` | Temperature 0 vs 0.1 |
| `fine-tuned_sys-short_fewshot-none_temp-0.7_user-grounded` | `5g4data-<model_tag>-fine-tuned-sys-short-fewshot-none-temp-0.7` | `user-grounded` | Temperature 0.7 vs 0.1 |
| `fine-tuned_sys-short_fewshot-none_temp-0.1_user-notgrounded` | `5g4data-<model_tag>-fine-tuned-sys-short-fewshot-none-temp-0.1` | `user-notgrounded` | NL only (same Ollama name as the short baseline) |
| `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-notgrounded` | `5g4data-<model_tag>-fine-tuned-sys-long-fewshot-net-dep-both-temp-0.1` | `user-notgrounded` | NL only on the long+few-shot model |
| `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-grounded_postprocessing` | `5g4data-<model_tag>-fine-tuned-sys-long-fewshot-net-dep-both-temp-0.1` | `user-grounded` + postprocess | Production twin of the long+few-shot grounded cell |

The unique experiment key is the cell id (`exp_<cell_id>/REPORT.md`).

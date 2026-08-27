# Summary `20260826_185205_qwen3.8-27b` · `qwen3.8-27b`

Pass % of prompts per criterion (rows) × cell (columns).
Ranking for production: **nl_semantic** → **both_shacl** → **structural_all_pass**.
Production-eligible if all three are ≥ 70%.

| Criterion | `fine-tuned_sys-short_fewshot-none_temp-0.1_user-grounded` | `stock_sys-short_fewshot-none_temp-0.1_user-grounded` | `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-grounded` | `fine-tuned_sys-short_fewshot-net-dep-both_temp-0.1_user-grounded` | `fine-tuned_sys-long_fewshot-none_temp-0.1_user-grounded` | `fine-tuned_sys-short_fewshot-none_temp-0_user-grounded` | `fine-tuned_sys-short_fewshot-none_temp-0.7_user-grounded` | `fine-tuned_sys-short_fewshot-none_temp-0.1_user-notgrounded` | `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-notgrounded` | `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-grounded_postprocessing` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `prefixes` | 90.0% | 0.0% | 100.0% | 100.0% | 65.0% | 90.0% | 85.0% | 0.0% | 100.0% | 100.0% |
| `intent_and_expectations` | 25.0% | 0.0% | 100.0% | 100.0% | 100.0% | 45.0% | 25.0% | 5.0% | 100.0% | 100.0% |
| `condition_or_context` | 50.0% | 0.0% | 100.0% | 100.0% | 0.0% | 50.0% | 40.0% | 10.0% | 100.0% | 100.0% |
| `reporting_per_expectation` | 50.0% | 100.0% | 95.0% | 50.0% | 0.0% | 45.0% | 65.0% | 85.0% | 95.0% | 100.0% |
| `fewshot_structure` | 20.0% | 0.0% | 100.0% | 100.0% | 0.0% | 25.0% | 25.0% | 10.0% | 100.0% | 100.0% |
| `uuid4_unique` | 35.0% | 65.0% | 30.0% | 50.0% | 40.0% | 50.0% | 40.0% | 45.0% | 55.0% | 100.0% |
| `usecase_shacl` | 0.0% | 90.0% | 100.0% | 40.0% | 0.0% | 0.0% | 0.0% | 0.0% | 95.0% | 100.0% |
| `tio_shacl` | 0.0% | 90.0% | 100.0% | 85.0% | 0.0% | 0.0% | 0.0% | 0.0% | 75.0% | 100.0% |
| `both_shacl` | 0.0% | 90.0% | 100.0% | 40.0% | 0.0% | 0.0% | 0.0% | 0.0% | 75.0% | 100.0% |
| `nl_semantic` | 30.0% | 0.0% | 80.0% | 90.0% | 35.0% | 35.0% | 15.0% | 0.0% | 75.0% | 100.0% |
| `structural_all_pass` | 0.0% | 0.0% | 30.0% | 25.0% | 0.0% | 0.0% | 0.0% | 0.0% | 55.0% | 100.0% |
| n | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 |

## Production-eligible

- `fine-tuned_sys-long_fewshot-net-dep-both_temp-0.1_user-grounded_postprocessing` · Ollama `5g4data-qwen3.8-27b-fine-tuned-sys-long-fewshot-net-dep-both-temp-0.1` · nl 100.0%, both SHACL 100.0%, structure 100.0%

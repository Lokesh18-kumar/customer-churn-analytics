---
name: Statistical evidence policy
description: Durable rules for interpreting the churn dashboard's inferential and predictive outputs.
---

Statistical evidence must distinguish descriptive rates, adjusted significance, practical effect size, predictive utility, association, and causation. Sparse multi-group contingency tables must not receive a fabricated chi-square p-value; report the p-value as not estimable when the expected-count assumptions are not met. Multiple estimable tests use Benjamini–Hochberg correction, and model preprocessing must be fit on training rows only.

**Why:** The churn dashboard is intended for defensible decisions, and sparse groups or leakage can make apparently precise results misleading.

**How to apply:** Preserve these distinctions when extending tests, model validation, exports, recommendations, or UI copy.
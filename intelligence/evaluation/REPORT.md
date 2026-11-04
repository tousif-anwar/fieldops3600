# Actual synthetic evaluation

Executed: 2026-11-04T22:15:56.413002+00:00
Python 3.14.4; Windows-11-10.0.26300-SP0

These are measured results on generated data. They establish no real-world accuracy.

The first 60% of chronological observations train the logistic model, the next 20% fit
a sigmoid calibration model, and only the final 20% evaluate either strategy.
One observation per stage prevents a stage from appearing in multiple partitions.

| Predictor | Precision | Recall | F1 | ROC AUC | PR AUC | Brier | False-alert rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| ruleBaseline | 0.6842 | 0.3269 | 0.4424 | 0.6255 | 0.6666 | 0.3254 | 0.1703 |
| calibratedLogistic | 0.7739 | 0.7350 | 0.7540 | 0.8248 | 0.8373 | 0.1708 | 0.2424 |

Single-observation median latency: 19.819 ms; p95: 35.241 ms.
The latency includes pandas preprocessing and classifier inference; it excludes network transit.

| Dispatcher | Assigned | Unassigned | Travel proxy (min) | Workload SD (min) | Runtime (ms) | Status |
|---|---:|---:|---:|---:|---:|---|
| baseline | 22 | 0 | 647 | 47.17 | 6.38 | GREEDY |
| optimized | 22 | 0 | 619 | 47.96 | 3048.46 | FEASIBLE |

Both strategies use the same six technicians and 22 jobs. Both outputs are independently
checked for skills, certification, availability, duration and overlap violations.
The optimizer trades travel, delay and workload spread against priority-weighted unassigned jobs.
A time limit may return a feasible solution without proving optimality. The JSON records bounds.
Travel is a depot-distance proxy; workload-based SLA risk is a heuristic, not a learned probability.
No route-level travel-time feasibility or real traffic data is claimed.

See `results.json` for the split boundaries, calibration bins, per-job explanations, assignments, and machine-specific timings.

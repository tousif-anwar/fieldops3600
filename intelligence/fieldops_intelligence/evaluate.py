"""Run `python -m fieldops_intelligence.evaluate` from intelligence/."""

import json
import platform
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

from .prediction import evaluate
from .scheduling import evaluate_scheduling


def main():
    output = Path(__file__).resolve().parents[1] / "evaluation"
    output.mkdir(parents=True, exist_ok=True)
    result = {
        "executedAtUtc": datetime.now(UTC).isoformat(),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "dependencies": {name: version(name) for name in ["numpy", "pandas", "scikit-learn", "ortools", "fastapi"]},
        "prediction": evaluate(),
        "scheduling": evaluate_scheduling(),
    }
    (output / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    prediction = result["prediction"]
    lines = [
        "# Actual synthetic evaluation",
        "",
        f"Executed: {result['executedAtUtc']}",
        f"Python {result['python']}; {result['platform']}",
        "",
        "These are measured results on generated data. They establish no real-world accuracy.",
        "",
        "The first 60% of chronological observations train the logistic model, the next 20% fit",
        "a sigmoid calibration model, and only the final 20% evaluate either strategy.",
        "One observation per stage prevents a stage from appearing in multiple partitions.",
        "",
        "| Predictor | Precision | Recall | F1 | ROC AUC | PR AUC | Brier | False-alert rate |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in ["ruleBaseline", "calibratedLogistic"]:
        m = prediction[name]
        lines.append(
            f"| {name} | {m['precision']:.4f} | {m['recall']:.4f} | {m['f1']:.4f} | {m['rocAuc']:.4f} | {m['precisionRecallAuc']:.4f} | {m['brierScore']:.4f} | {m['falseAlertRate']:.4f} |"
        )
    lines += [
        "",
        f"Single-observation median latency: {prediction['latency']['singlePredictionMedianMs']:.3f} ms; p95: {prediction['latency']['singlePredictionP95Ms']:.3f} ms.",
        "The latency includes pandas preprocessing and classifier inference; it excludes network transit.",
        "",
        "| Dispatcher | Assigned | Unassigned | Travel proxy (min) | Workload SD (min) | Runtime (ms) | Status |",
        "|---|---:|---:|---:|---:|---:|---|",
    ]
    for name in ["baseline", "optimized"]:
        strategy = result["scheduling"][name]
        m = strategy["metrics"]
        lines.append(
            f"| {name} | {m['assignedJobs']} | {m['unassignedJobs']} | {m['estimatedTravelMinutes']} | {m['workloadStandardDeviationMinutes']:.2f} | {m['runtimeMilliseconds']:.2f} | {strategy['solverStatus']} |"
        )
    lines += [
        "",
        "Both strategies use the same six technicians and 22 jobs. Both outputs are independently",
        "checked for skills, certification, availability, duration and overlap violations.",
        "The optimizer trades travel, delay and workload spread against priority-weighted unassigned jobs.",
        "A time limit may return a feasible solution without proving optimality. The JSON records bounds.",
        "Travel is a depot-distance proxy; workload-based SLA risk is a heuristic, not a learned probability.",
        "No route-level travel-time feasibility or real traffic data is claimed.",
        "",
        "See `results.json` for the split boundaries, calibration bins, per-job explanations, assignments, and machine-specific timings.",
    ]
    (output / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "prediction": prediction["calibratedLogistic"],
                "scheduling": {key: result["scheduling"][key]["metrics"] for key in ["baseline", "optimized"]},
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

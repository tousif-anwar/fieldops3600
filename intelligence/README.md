# Advisory intelligence

This private Python service implements two independent capabilities: an SLA breach classifier and two dispatch strategies. It never changes workflow state, books a technician, pauses a deadline, or evaluates employees. The gateway authenticates and authorizes requests; this container must remain on the private Compose network without a published port.

## Run and verify

Python 3.14 is used in the container. From the repository root:

```powershell
python -m venv intelligence/.venv
intelligence/.venv/Scripts/python -m pip install -r intelligence/requirements-dev.txt
$env:PYTHONPATH = 'intelligence'
intelligence/.venv/Scripts/python -m pytest -c intelligence/pyproject.toml tests/intelligence -q
intelligence/.venv/Scripts/python -m fieldops_intelligence.evaluate
intelligence/.venv/Scripts/python -m uvicorn fieldops_intelligence.api:app --host 127.0.0.1 --port 8000
```

On Linux/macOS, use `intelligence/.venv/bin/python` and `PYTHONPATH=intelligence`. A local isolated `.packages` directory is supported by the tests but is not needed in a fresh virtual environment or Docker. Run lint with `ruff check --config intelligence/pyproject.toml intelligence/fieldops_intelligence tests/intelligence` and `ruff format --check --config intelligence/pyproject.toml intelligence/fieldops_intelligence tests/intelligence`.

The model is fitted once during application startup from a deterministic synthetic dataset. Readiness is exposed only after startup finishes. No downloaded model, credentials, training customer data, or binary model artifact is committed.

## SLA prediction

`POST /predict` accepts:

```json
{
  "serviceCategory": "Cooling",
  "stageIndex": 3,
  "technicianWorkload": 5,
  "historicalStageDurationMinutes": 27,
  "elapsedMinutes": 22,
  "progress": 0.3,
  "priority": "High",
  "previousDelays": 1,
  "equipmentCategory": "Commercial"
}
```

The response contains `breachRisk`, `riskCategory`, `factors`, `predictedAtUtc`, `modelVersion`, `suggestedIntervention`, `syntheticTraining: true`, and `advisory: true`. Unexpected fields, invalid enumerations, and out-of-range numeric values are rejected. The backend must supply authoritative effective elapsed time and scope any job-specific data to the requesting user's team. Client feature values do not override deadlines.

`prediction.py` defines all nine predictors. The only duration predictor is a historical reference available before prediction. No work order or employee identifier, actual final duration, outcome, or future timestamp is a predictor. Each stage contributes exactly one observation. Synthetic latent complexity influences progress and the eventual duration separately; progress is not calculated from the final duration.

The first 60% of chronological observations train a logistic regression with standardized numeric fields and one-hot categorical fields. The following 20% calibrate probabilities with a separate sigmoid model. The final 20% evaluate both that classifier and an elapsed-time/workload rule. Future labels never participate in preprocessing, fitting, calibration, or threshold selection. The alert threshold is fixed at 0.5 before evaluation.

The evaluation records precision, recall, F1, ROC-AUC, average precision (PR-AUC), Brier score, calibration bins, expected calibration error, false-positive rate among actual negatives, prevalence, and measured inference latency. Calibration is established only on the synthetic distribution. Factor contributions are linear classifier log-odds associations, not causal explanations.

The measured evaluation and its machine-specific timings are in [evaluation/REPORT.md](evaluation/REPORT.md) and [evaluation/results.json](evaluation/results.json). Neither proves real-world effectiveness. Before real deployment, replace the synthetic source with governed historical snapshots, split by time and episode, assess subgroup/error costs, recalibrate, monitor drift, and validate interventions prospectively. Outcome-derived or future information must stay out of the feature pipeline.

## Dispatch strategies

`POST /optimize` accepts:

```json
{
  "technicians": [{
    "id": "tech-01",
    "skills": ["HVAC", "Cooling"],
    "certifications": ["EPA608"],
    "workingHours": {"startMinute": 480, "endMinute": 1020},
    "availability": [{"startMinute": 480, "endMinute": 720}],
    "existingBookings": [{"startMinute": 540, "endMinute": 600}],
    "workloadMinutes": 60,
    "x": 8,
    "y": 12
  }],
  "jobs": [{
    "id": "wo-01",
    "requiredSkills": ["Cooling"],
    "requiredCertifications": ["EPA608"],
    "earliestStartMinute": 600,
    "latestEndMinute": 720,
    "durationMinutes": 60,
    "priority": "High",
    "x": 10,
    "y": 14
  }],
  "strategy": "optimized",
  "timeLimitSeconds": 3
}
```

Times are integer minutes in one explicitly chosen service day; callers must convert actual UTC appointments and DST-aware working hours before calling. Coordinates are kilometres in a local planar coordinate system. Empty availability means the working-hours interval. Explicit windows represent time-off exceptions. Appointment windows and working intervals use `[start,end)` semantics.

The baseline greedily assigns priority-ordered jobs to feasible technicians using travel, existing workload, and start delay. The OR-Tools CP-SAT strategy uses optional intervals and `NoOverlap` constraints, with skills/certifications and availability restricting its domains. It minimizes priority-weighted unassigned jobs, depot travel, start delay, and workload spread. Search uses one worker and a fixed seed; a bounded search can return `FEASIBLE` without proving optimality. The response records the solver status and objective bound.

Both strategies pass the same independent output validator. Tests include scarce skill preservation, time off, fully booked/unqualified technicians, duplicate IDs, deliberate invalid output, and the shared reproducible scenario. The response includes per-job explanations and measured feasibility, unassigned count, travel proxy, workload distribution, workload SLA risk proxy, and runtime.

Travel is a straight-line round trip from a technician's base at an assumed 40 km/h. Traffic, road routes, and travel between successive appointments are not modeled. The SLA risk proxy is an explicit workload heuristic and is not the classifier's probability. These limitations appear in every response. A recommendation never reserves capacity: the Scheduling Service must revalidate availability and commit under its PostgreSQL overlap constraint. A dispatcher can override a recommendation only through the authoritative, audited booking API.

## API and trust boundary

- `GET /health`: readiness, model version, synthetic-data flag.
- `POST /predict`: one advisory stage prediction.
- `POST /optimize`: one bounded dispatch optimization or baseline run.

The service is deliberately stateless. Operational acceptance/dismissal of an advisory recommendation belongs to the Workflow/Scheduling Service and its audit stream. A probability is never itself an operational action. The application provides no employee ranking or automatic penalty mechanism.

The container runs as UID 10001, has one worker, and limits concurrent Uvicorn requests. Optimization limits are validated at a maximum of ten seconds, 50 technicians, and 150 jobs. Production deployments also need gateway rate limits, TLS at the boundary, resource limits, and a governed model lifecycle. Public exposure of this unauthenticated internal service is unsupported.

Primary implementation references: [scikit-learn model evaluation](https://scikit-learn.org/stable/modules/model_evaluation.html), [probability calibration](https://scikit-learn.org/stable/modules/calibration.html), and [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver).

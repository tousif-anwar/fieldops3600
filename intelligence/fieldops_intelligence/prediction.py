"""Synthetic, temporally evaluated SLA model; probabilities are advisory only.

Each row is one snapshot of an active stage. All predictors are available at that
snapshot; the eventual duration is used only to construct the label. Synthetic
results establish reproducibility, not accuracy on a real HVAC operation.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from functools import lru_cache
from time import perf_counter
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

MODEL_VERSION = "synthetic-logistic-v1"
NUMERIC = [
    "stageIndex",
    "technicianWorkload",
    "historicalStageDurationMinutes",
    "elapsedMinutes",
    "progress",
    "previousDelays",
]
CATEGORICAL = ["serviceCategory", "priority", "equipmentCategory"]
FEATURES = NUMERIC + CATEGORICAL
FEATURE_DEFINITIONS = {
    "stageIndex": "Zero-based position in the eight-stage workflow.",
    "technicianWorkload": "Assigned jobs still open at prediction time.",
    "historicalStageDurationMinutes": "Mean of completed historical stages before the prediction.",
    "elapsedMinutes": "Server-authoritative effective elapsed time excluding approved pauses.",
    "progress": "Most recent technician-reported progress fraction; never inferred from the outcome.",
    "previousDelays": "Earlier completed stages with a recorded delay, known before this snapshot.",
    "serviceCategory": "Requested service category.",
    "priority": "Work-order priority at prediction time.",
    "equipmentCategory": "Equipment class known before inspection.",
}


class PredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    serviceCategory: Literal["HVAC", "Heating", "Cooling", "Ventilation"] = "HVAC"
    stageIndex: int = Field(ge=0, le=7)
    technicianWorkload: int = Field(ge=0, le=30)
    historicalStageDurationMinutes: float = Field(ge=1, le=240)
    elapsedMinutes: float = Field(ge=0, le=240)
    progress: float = Field(ge=0, le=1)
    priority: Literal["Low", "Normal", "High", "Critical"] = "Normal"
    previousDelays: int = Field(ge=0, le=7)
    equipmentCategory: Literal["Residential", "Commercial", "Industrial"] = "Residential"


def generate_dataset(count: int = 6000, seed: int = 360) -> pd.DataFrame:
    """One observation per stage/episode; no stage can straddle data splits.

    Latent complexity influences progress and future duration separately. Progress
    is a noisy independent field observation, not elapsed/final-duration. The
    historical duration is a simulated pre-existing reference, not this outcome.
    """
    rng = np.random.default_rng(seed)
    rows: list[dict[str, Any]] = []
    origin = datetime(2025, 1, 1, tzinfo=UTC)
    stage_means = [12, 24, 20, 27, 29, 18, 14, 11]
    for i in range(count):
        stage = int(rng.integers(0, 8))
        workload = int(rng.integers(1, 8))
        complexity = float(rng.normal())
        category = str(rng.choice(["HVAC", "Heating", "Cooling", "Ventilation"]))
        priority = str(rng.choice(["Low", "Normal", "High", "Critical"], p=[0.12, 0.50, 0.28, 0.10]))
        equipment = str(rng.choice(["Residential", "Commercial", "Industrial"], p=[0.55, 0.35, 0.10]))
        previous_delays = int(rng.binomial(stage, 0.22))
        # Time drift is intentional; evaluation cannot shuffle future rows into training.
        drift = i / max(count, 1) * 2.5
        historical = max(5.0, stage_means[stage] + float(rng.normal(0, 1.8)))
        elapsed = float(rng.uniform(2, 28))
        progress = float(np.clip(0.16 + elapsed / 43 - 0.13 * complexity + rng.normal(0, 0.12), 0, 0.98))
        duration = (
            historical
            + 1.6 * (workload - 3)
            + 4.5 * complexity
            + 2.0 * previous_delays
            + {"Residential": 0, "Commercial": 3, "Industrial": 7}[equipment]
            + {"HVAC": 1, "Heating": 2, "Cooling": 3, "Ventilation": -1}[category]
            + {"Low": 0, "Normal": 0, "High": 1, "Critical": 3}[priority]
            + drift
            + float(rng.normal(0, 7))
        )
        # Only active-stage snapshots can be scored; completed stages are excluded.
        if duration <= elapsed:
            continue
        rows.append(
            {
                "observedAtUtc": origin + timedelta(minutes=i * 20),
                "stageIndex": stage,
                "technicianWorkload": workload,
                "historicalStageDurationMinutes": historical,
                "elapsedMinutes": elapsed,
                "progress": progress,
                "previousDelays": previous_delays,
                "serviceCategory": category,
                "priority": priority,
                "equipmentCategory": equipment,
                "breached": int(duration > 30),
            }
        )
    return pd.DataFrame(rows).sort_values("observedAtUtc").reset_index(drop=True)


def chronological_split(data: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    first, second = int(len(data) * 0.60), int(len(data) * 0.80)
    return data.iloc[:first].copy(), data.iloc[first:second].copy(), data.iloc[second:].copy()


def _logits(probabilities: np.ndarray) -> np.ndarray:
    clipped = np.clip(probabilities, 1e-6, 1 - 1e-6)
    return np.log(clipped / (1 - clipped)).reshape(-1, 1)


class BreachModel:
    def __init__(self, data: pd.DataFrame):
        train, calibration, self.test = chronological_split(data)
        self.split = {
            name: {
                "rows": len(part),
                "from": part.observedAtUtc.min().isoformat(),
                "through": part.observedAtUtc.max().isoformat(),
            }
            for name, part in [("train", train), ("calibration", calibration), ("test", self.test)]
        }
        transform = ColumnTransformer(
            [
                ("numeric", StandardScaler(), NUMERIC),
                ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL),
            ]
        )
        self.pipeline = Pipeline(
            [
                ("transform", transform),
                ("classifier", LogisticRegression(max_iter=1000, random_state=360)),
            ]
        )
        self.pipeline.fit(train[FEATURES], train.breached)
        # Platt calibration uses a later, disjoint block; test labels never reach fitting.
        self.calibrator = LogisticRegression(C=1_000_000, max_iter=1000, random_state=360)
        self.calibrator.fit(_logits(self.pipeline.predict_proba(calibration[FEATURES])[:, 1]), calibration.breached)

    def probabilities(self, data: pd.DataFrame) -> np.ndarray:
        return self.calibrator.predict_proba(_logits(self.pipeline.predict_proba(data[FEATURES])[:, 1]))[:, 1]

    def predict(self, request: PredictionRequest) -> dict[str, Any]:
        row = pd.DataFrame([request.model_dump()])
        probability = float(self.probabilities(row)[0])
        transformed = self.pipeline.named_steps["transform"].transform(row[FEATURES])[0]
        coefficients = self.pipeline.named_steps["classifier"].coef_[0]
        feature_names = self.pipeline.named_steps["transform"].get_feature_names_out()
        contributions = sorted(zip(feature_names, transformed * coefficients), key=lambda item: item[1], reverse=True)
        factors = [
            {
                "feature": str(name).split("__", 1)[-1],
                "contribution": round(float(value), 4),
                "description": f"{str(name).split('__', 1)[-1]} contributes {float(value):+.2f} to the model log-odds; association, not a cause.",
            }
            for name, value in contributions
            if value > 0
        ][:3]
        category = "High" if probability >= 0.7 else "Moderate" if probability >= 0.4 else "Low"
        return {
            "breachRisk": round(probability, 5),
            "riskCategory": category,
            "factors": factors,
            "predictedAtUtc": datetime.now(UTC).isoformat(),
            "modelVersion": MODEL_VERSION,
            "syntheticTraining": True,
            "advisory": True,
            "suggestedIntervention": (
                "Contact technician and confirm progress; review parts or arrange assistance."
                if category == "High"
                else "Request a status confirmation."
                if category == "Moderate"
                else "Continue routine monitoring."
            ),
            "limitation": "Calibrated on synthetic data only. Not validated for real-world decisions or employee ranking.",
        }


def rule_probabilities(data: pd.DataFrame) -> np.ndarray:
    """Transparent baseline: elapsed-time warning with a workload adjustment."""
    score = (data.elapsedMinutes.to_numpy() - 20) / 4 + (data.technicianWorkload.to_numpy() - 4) * 0.12
    return 1 / (1 + np.exp(-score))


def metrics(labels: np.ndarray, probabilities: np.ndarray) -> dict[str, Any]:
    predicted = probabilities >= 0.5
    negatives = labels == 0
    calibration_bins = []
    ece = 0.0
    for index in range(10):
        lower, upper = index / 10, (index + 1) / 10
        mask = (probabilities >= lower) & ((probabilities < upper) if index < 9 else (probabilities <= upper))
        if not mask.any():
            continue
        predicted_mean, actual_mean = float(probabilities[mask].mean()), float(labels[mask].mean())
        ece += mask.mean() * abs(predicted_mean - actual_mean)
        calibration_bins.append(
            {
                "lower": lower,
                "upper": upper,
                "count": int(mask.sum()),
                "meanPredicted": predicted_mean,
                "observedRate": actual_mean,
            }
        )
    return {
        "precision": float(precision_score(labels, predicted, zero_division=0)),
        "recall": float(recall_score(labels, predicted, zero_division=0)),
        "f1": float(f1_score(labels, predicted, zero_division=0)),
        "rocAuc": float(roc_auc_score(labels, probabilities)) if len(np.unique(labels)) > 1 else None,
        "precisionRecallAuc": float(average_precision_score(labels, probabilities)),
        "brierScore": float(brier_score_loss(labels, probabilities)),
        "expectedCalibrationError": float(ece),
        "falseAlertRate": float(((predicted == 1) & negatives).sum() / max(negatives.sum(), 1)),
        "threshold": 0.5,
        "calibrationBins": calibration_bins,
    }


@lru_cache(maxsize=1)
def get_model() -> BreachModel:
    return BreachModel(generate_dataset())


def evaluate() -> dict[str, Any]:
    model = get_model()
    test = model.test
    started = perf_counter()
    probabilities = model.probabilities(test)
    batch_latency_ms = (perf_counter() - started) * 1000
    single_latencies = []
    for index in range(min(100, len(test))):
        started = perf_counter()
        model.probabilities(test.iloc[[index]])
        single_latencies.append((perf_counter() - started) * 1000)
    return {
        "modelVersion": MODEL_VERSION,
        "synthetic": True,
        "seed": 360,
        "split": model.split,
        "features": FEATURE_DEFINITIONS,
        "target": "Eventual effective stage duration greater than 30 minutes",
        "observedPrevalence": float(test.breached.mean()),
        "ruleBaseline": metrics(test.breached.to_numpy(), rule_probabilities(test)),
        "calibratedLogistic": metrics(test.breached.to_numpy(), probabilities),
        "latency": {
            "batchRows": len(test),
            "batchMilliseconds": batch_latency_ms,
            "singlePredictionMedianMs": float(np.median(single_latencies)),
            "singlePredictionP95Ms": float(np.percentile(single_latencies, 95)),
        },
        "limitation": "Entirely synthetic data. No real-world predictive performance is established. Runtime is machine-specific.",
    }

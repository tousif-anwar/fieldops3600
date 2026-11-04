import numpy as np
import pandas as pd
import pytest
from fieldops_intelligence.prediction import (
    FEATURES,
    PredictionRequest,
    chronological_split,
    generate_dataset,
    get_model,
    metrics,
)
from pydantic import ValidationError


def request(**overrides):
    return PredictionRequest(
        **{
            "stageIndex": 3,
            "technicianWorkload": 5,
            "historicalStageDurationMinutes": 27,
            "elapsedMinutes": 22,
            "progress": 0.3,
            "previousDelays": 1,
            **overrides,
        }
    )


def test_reproducible_data_and_strictly_chronological_disjoint_split():
    left, right = generate_dataset(1000), generate_dataset(1000)
    pd.testing.assert_frame_equal(left, right)
    train, calibration, test = chronological_split(left)
    assert train.observedAtUtc.max() < calibration.observedAtUtc.min()
    assert calibration.observedAtUtc.max() < test.observedAtUtc.min()
    assert len(train) + len(calibration) + len(test) == len(left)
    assert len(set(train.index) & set(test.index)) == 0


def test_no_identifiers_outcomes_or_future_timestamps_in_predictors():
    assert "breached" not in FEATURES
    assert not any("id" == f.lower() or "duration" == f.lower() for f in FEATURES)
    assert "observedAtUtc" not in FEATURES
    assert "finalDuration" not in FEATURES
    assert "historicalStageDurationMinutes" in FEATURES


def test_prediction_is_advisory_explicitly_synthetic_and_explainable():
    result = get_model().predict(request())
    assert 0 <= result["breachRisk"] <= 1
    assert result["syntheticTraining"] is True
    assert result["advisory"] is True
    assert result["modelVersion"]
    assert result["predictedAtUtc"].endswith("+00:00")
    assert result["suggestedIntervention"]
    assert result["factors"]
    assert "not a cause" in result["factors"][0]["description"]


def test_evaluation_metrics_have_known_denominators():
    result = metrics(np.array([1, 0, 1, 0]), np.array([0.9, 0.7, 0.6, 0.1]))
    assert result["precision"] == pytest.approx(2 / 3)
    assert result["recall"] == 1
    assert result["falseAlertRate"] == 0.5  # one false alert / two actual negatives
    assert result["threshold"] == 0.5


@pytest.mark.parametrize(
    "override", [{"stageIndex": 8}, {"progress": 1.1}, {"elapsedMinutes": -1}, {"technicianId": "not-a-feature"}]
)
def test_reject_invalid_or_unknown_prediction_features(override):
    with pytest.raises(ValidationError):
        request(**override)

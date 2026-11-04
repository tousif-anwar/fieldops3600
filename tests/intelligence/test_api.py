from fastapi.testclient import TestClient
from fieldops_intelligence.api import app


def test_api_readiness_and_real_prediction():
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ready"
        response = client.post(
            "/predict",
            json={
                "stageIndex": 2,
                "technicianWorkload": 3,
                "historicalStageDurationMinutes": 22,
                "elapsedMinutes": 20,
                "progress": 0.2,
                "previousDelays": 0,
            },
        )
        assert response.status_code == 200
        assert response.json()["advisory"] is True
        assert client.post("/predict", json={"stageIndex": 55}).status_code == 422

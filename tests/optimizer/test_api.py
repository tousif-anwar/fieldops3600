from fastapi.testclient import TestClient
from fieldops_optimizer.api import app


def test_api_readiness_and_real_optimization():
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ready"
        response = client.post(
            "/optimize",
            json={
                "technicians": [
                    {
                        "id": "tech-01",
                        "skills": ["HVAC"],
                        "certifications": ["HVAC Safety"],
                        "workingHours": {"startMinute": 480, "endMinute": 1020},
                        "availability": [],
                        "existingBookings": [],
                        "workloadMinutes": 0,
                    }
                ],
                "jobs": [
                    {
                        "id": "wo-01",
                        "requiredSkills": ["HVAC"],
                        "requiredCertifications": ["HVAC Safety"],
                        "earliestStartMinute": 600,
                        "latestEndMinute": 660,
                        "durationMinutes": 60,
                        "priority": "Normal",
                    }
                ],
                "strategy": "baseline",
            },
        )
        assert response.status_code == 200
        assert response.json()["assignments"]
        assert client.post("/optimize", json={"strategy": "unknown"}).status_code == 422

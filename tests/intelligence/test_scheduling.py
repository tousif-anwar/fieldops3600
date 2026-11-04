import pytest
from fieldops_intelligence.scheduling import (
    Job,
    OptimizationRequest,
    Technician,
    Window,
    baseline,
    optimized,
    reproducible_scenario,
    validate_assignments,
)
from pydantic import ValidationError


def constrained_scenario():
    return OptimizationRequest(
        technicians=[
            Technician(
                id="a-multiskilled",
                skills=["HVAC", "Heating"],
                certifications=["EPA608"],
                workingHours=Window(startMinute=480, endMinute=540),
            ),
            Technician(id="b-general", skills=["HVAC"], x=5, workingHours=Window(startMinute=480, endMinute=540)),
        ],
        jobs=[
            Job(
                id="a-general",
                requiredSkills=["HVAC"],
                earliestStartMinute=480,
                latestEndMinute=540,
                durationMinutes=60,
            ),
            Job(
                id="b-specialist",
                requiredSkills=["Heating"],
                requiredCertifications=["EPA608"],
                earliestStartMinute=480,
                latestEndMinute=540,
                durationMinutes=60,
            ),
        ],
        timeLimitSeconds=1,
    )


def test_optimizer_preserves_rare_skill_capacity():
    scenario = constrained_scenario()
    greedy = baseline(scenario.model_copy(update={"strategy": "baseline"}))
    advanced = optimized(scenario)
    assert greedy["metrics"]["assignedJobs"] == 1
    assert advanced["metrics"]["assignedJobs"] == 2
    assert not advanced["metrics"]["hardConstraintViolations"]
    assignment = {a["jobId"]: a["technicianId"] for a in advanced["assignments"]}
    assert assignment["b-specialist"] == "a-multiskilled"


@pytest.mark.parametrize("strategy", [baseline, optimized])
def test_no_qualifications_or_capacity_means_unassigned(strategy):
    scenario = constrained_scenario()
    scenario.technicians = [
        Technician(id="unqualified", skills=["Electrical"], workingHours=Window(startMinute=480, endMinute=540))
    ]
    result = strategy(scenario)
    assert result["metrics"]["assignedJobs"] == 0
    assert result["metrics"]["unassignedJobs"] == 2


@pytest.mark.parametrize("strategy", [baseline, optimized])
def test_existing_bookings_and_time_off_enforced(strategy):
    scenario = constrained_scenario()
    scenario.technicians[0].existingBookings = [Window(startMinute=480, endMinute=540)]
    scenario.technicians[1].availability = [Window(startMinute=510, endMinute=540)]
    result = strategy(scenario)
    assert result["metrics"]["assignedJobs"] == 0
    assert result["metrics"]["feasible"] is True


def test_independent_validator_detects_overlap_and_duplicate_job():
    scenario = constrained_scenario()
    invalid = [
        {"jobId": "a-general", "technicianId": "a-multiskilled", "startMinute": 480, "endMinute": 540},
        {"jobId": "a-general", "technicianId": "a-multiskilled", "startMinute": 480, "endMinute": 540},
    ]
    errors = validate_assignments(scenario, invalid)
    assert any("Duplicate" in e for e in errors)
    assert any("Overlap" in e for e in errors)


@pytest.mark.parametrize("strategy", [baseline, optimized])
def test_reproducible_scenario_is_feasible_with_explanations(strategy):
    result = strategy(reproducible_scenario())
    assert result["metrics"]["feasible"]
    assert result["assignments"]
    assert all(len(a["explanation"]) >= 4 for a in result["assignments"])
    assert result["metrics"]["runtimeMilliseconds"] > 0


def test_duplicate_ids_rejected_in_request():
    scenario = constrained_scenario().model_dump()
    scenario["jobs"][1]["id"] = scenario["jobs"][0]["id"]
    with pytest.raises(ValidationError):
        OptimizationRequest(**scenario)

"""Explainable dispatch strategies sharing exactly the same hard constraints.

Travel is a straight-line, round-trip-from-depot estimate at 40 km/h. It is a
soft cost, not routing or a traffic-aware guarantee. Final bookings must still
pass the Scheduling Service transaction and PostgreSQL overlap constraint.
"""

from __future__ import annotations

from math import hypot
from time import perf_counter
from typing import Literal

import numpy as np
from ortools.sat.python import cp_model
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    startMinute: int = Field(ge=0, le=1439)
    endMinute: int = Field(ge=1, le=1440)

    @model_validator(mode="after")
    def ordered(self):
        if self.endMinute <= self.startMinute:
            raise ValueError("endMinute must be after startMinute")
        return self


class Technician(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    skills: list[str] = Field(min_length=1, max_length=20)
    certifications: list[str] = Field(default_factory=list, max_length=20)
    workingHours: Window
    availability: list[Window] = Field(default_factory=list, max_length=20)
    existingBookings: list[Window] = Field(default_factory=list, max_length=50)
    workloadMinutes: int = Field(default=0, ge=0, le=10080)
    x: float = Field(default=0, ge=-1000, le=1000)
    y: float = Field(default=0, ge=-1000, le=1000)


class Job(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    requiredSkills: list[str] = Field(min_length=1, max_length=20)
    requiredCertifications: list[str] = Field(default_factory=list, max_length=20)
    earliestStartMinute: int = Field(ge=0, le=1439)
    latestEndMinute: int = Field(ge=1, le=1440)
    durationMinutes: int = Field(ge=1, le=480)
    priority: Literal["Low", "Normal", "High", "Critical"] = "Normal"
    x: float = Field(default=0, ge=-1000, le=1000)
    y: float = Field(default=0, ge=-1000, le=1000)

    @model_validator(mode="after")
    def possible_window(self):
        if self.latestEndMinute <= self.earliestStartMinute:
            raise ValueError("Job appointment window must be ordered")
        return self


class OptimizationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    technicians: list[Technician] = Field(min_length=1, max_length=50)
    jobs: list[Job] = Field(min_length=1, max_length=150)
    strategy: Literal["baseline", "optimized"] = "optimized"
    timeLimitSeconds: float = Field(default=3, ge=0.1, le=10)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({t.id for t in self.technicians}) != len(self.technicians):
            raise ValueError("Technician IDs must be unique")
        if len({j.id for j in self.jobs}) != len(self.jobs):
            raise ValueError("Job IDs must be unique")
        return self


PRIORITY = {"Low": 1, "Normal": 2, "High": 4, "Critical": 8}


def qualified(technician: Technician, job: Job) -> bool:
    return set(job.requiredSkills) <= set(technician.skills) and set(job.requiredCertifications) <= set(
        technician.certifications
    )


def overlaps(start: int, end: int, booking: Window) -> bool:
    return start < booking.endMinute and end > booking.startMinute


def candidate_bounds(technician: Technician, job: Job) -> list[tuple[int, int]]:
    if not qualified(technician, job):
        return []
    # An empty availability list means the full working-hours interval.
    windows = technician.availability or [technician.workingHours]
    result = []
    for window in windows:
        start = max(window.startMinute, technician.workingHours.startMinute, job.earliestStartMinute)
        latest_start = (
            min(window.endMinute, technician.workingHours.endMinute, job.latestEndMinute) - job.durationMinutes
        )
        if start <= latest_start:
            result.append((start, latest_start))
    return result


def travel_minutes(technician: Technician, job: Job) -> int:
    return round(hypot(technician.x - job.x, technician.y - job.y) * 2 / 40 * 60)


def explain(technician: Technician, job: Job, start: int, assigned_minutes: int) -> list[str]:
    return [
        f"Meets all {len(job.requiredSkills)} required skills and {len(job.requiredCertifications)} certifications.",
        f"Fits working hours and availability at minute {start}; no confirmed booking overlaps.",
        f"Estimated round-trip travel from depot: {travel_minutes(technician, job)} minutes (straight-line proxy).",
        f"Existing workload {technician.workloadMinutes} minutes; proposed daily service total {assigned_minutes} minutes.",
        f"{job.priority} priority receives weight {PRIORITY[job.priority]} when comparing unassigned work.",
    ]


def _summarize(request: OptimizationRequest, assigned: list[dict], runtime: float, status: str) -> dict:
    technicians = {t.id: t for t in request.technicians}
    jobs = {j.id: j for j in request.jobs}
    workloads = {t.id: t.workloadMinutes for t in request.technicians}
    for item in assigned:
        workloads[item["technicianId"]] += jobs[item["jobId"]].durationMinutes
    for item in assigned:
        technician, job = technicians[item["technicianId"]], jobs[item["jobId"]]
        item["explanation"] = explain(technician, job, item["startMinute"], workloads[technician.id])
        item["estimatedTravelMinutes"] = travel_minutes(technician, job)
    assigned_ids = {a["jobId"] for a in assigned}
    unassigned = [
        {
            "jobId": j.id,
            "reason": "No feasible capacity found within qualifications, hours, availability and existing bookings.",
        }
        for j in request.jobs
        if j.id not in assigned_ids
    ]
    violations = validate_assignments(request, assigned)
    return {
        "strategy": request.strategy,
        "solverStatus": status,
        "assignments": sorted(assigned, key=lambda a: (a["startMinute"], a["jobId"])),
        "unassigned": unassigned,
        "metrics": {
            "feasible": not violations,
            "hardConstraintViolations": violations,
            "assignedJobs": len(assigned),
            "unassignedJobs": len(unassigned),
            "estimatedTravelMinutes": sum(a["estimatedTravelMinutes"] for a in assigned),
            "workloadMinutes": workloads,
            "workloadStandardDeviationMinutes": float(np.std(list(workloads.values()))),
            "expectedSlaRiskProxy": round(
                float(np.mean([min(1, workloads[a["technicianId"]] / 600) for a in assigned])), 4
            )
            if assigned
            else None,
            "runtimeMilliseconds": runtime * 1000,
        },
        "advisory": True,
        "limitations": [
            "The SLA metric is a workload proxy, not a validated probability.",
            "Travel is an estimate from technician depot; traffic and between-job routing are not modeled.",
            "Dispatch recommendations do not reserve capacity. The database transaction is the final conflict check.",
        ],
    }


def baseline(request: OptimizationRequest) -> dict:
    started = perf_counter()
    bookings = {t.id: list(t.existingBookings) for t in request.technicians}
    workloads = {t.id: t.workloadMinutes for t in request.technicians}
    assignments = []
    for job in sorted(request.jobs, key=lambda j: (-PRIORITY[j.priority], j.earliestStartMinute, j.id)):
        candidates = []
        for technician in request.technicians:
            for lower, upper in candidate_bounds(technician, job):
                # Move to booking end instead of rounding a valid minute away.
                candidate = lower
                for booking in sorted(bookings[technician.id], key=lambda b: b.startMinute):
                    if overlaps(candidate, candidate + job.durationMinutes, booking):
                        candidate = booking.endMinute
                if candidate <= upper:
                    score = (
                        travel_minutes(technician, job) * 3
                        + workloads[technician.id]
                        + (candidate - job.earliestStartMinute)
                    )
                    candidates.append((score, candidate, technician.id))
        if not candidates:
            continue
        _, start, technician_id = min(candidates)
        end = start + job.durationMinutes
        assignments.append({"jobId": job.id, "technicianId": technician_id, "startMinute": start, "endMinute": end})
        bookings[technician_id].append(Window(startMinute=start, endMinute=end))
        workloads[technician_id] += job.durationMinutes
    return _summarize(request, assignments, perf_counter() - started, "GREEDY")


def optimized(request: OptimizationRequest) -> dict:
    started = perf_counter()
    model = cp_model.CpModel()
    intervals_by_tech: dict[str, list] = {t.id: [] for t in request.technicians}
    choices: dict[tuple[str, str], tuple] = {}
    penalties = []
    for technician in request.technicians:
        for index, booking in enumerate(technician.existingBookings):
            intervals_by_tech[technician.id].append(
                model.new_fixed_size_interval_var(
                    booking.startMinute, booking.endMinute - booking.startMinute, f"existing_{technician.id}_{index}"
                )
            )
    for job in request.jobs:
        options = []
        for technician in request.technicians:
            bounds = candidate_bounds(technician, job)
            if not bounds:
                continue
            selected = model.new_bool_var(f"assign_{job.id}_{technician.id}")
            start = model.new_int_var_from_domain(
                cp_model.Domain.from_intervals(bounds), f"start_{job.id}_{technician.id}"
            )
            interval = model.new_optional_fixed_size_interval_var(
                start, job.durationMinutes, selected, f"visit_{job.id}_{technician.id}"
            )
            intervals_by_tech[technician.id].append(interval)
            choices[(job.id, technician.id)] = (selected, start)
            options.append(selected)
            penalties.append(selected * (travel_minutes(technician, job) * 3))
            # Delay counts only when selected, otherwise it must contribute zero.
            delay = model.new_int_var(0, 1440, f"delay_{job.id}_{technician.id}")
            model.add(delay == start - job.earliestStartMinute).only_enforce_if(selected)
            model.add(delay == 0).only_enforce_if(selected.Not())
            penalties.append(delay)
        unassigned = model.new_bool_var(f"unassigned_{job.id}")
        model.add(sum(options) + unassigned == 1)
        penalties.append(unassigned * PRIORITY[job.priority] * 1_000_000)
    for intervals in intervals_by_tech.values():
        model.add_no_overlap(intervals)
    loads = []
    for technician in request.technicians:
        load = model.new_int_var(0, 20000, f"load_{technician.id}")
        model.add(
            load
            == technician.workloadMinutes
            + sum(
                j.durationMinutes * choices[(j.id, technician.id)][0]
                for j in request.jobs
                if (j.id, technician.id) in choices
            )
        )
        loads.append(load)
    max_load, min_load = model.new_int_var(0, 20000, "max_load"), model.new_int_var(0, 20000, "min_load")
    model.add_max_equality(max_load, loads)
    model.add_min_equality(min_load, loads)
    penalties.append((max_load - min_load) * 2)
    model.minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.timeLimitSeconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 360
    status = solver.solve(model)
    assignments = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (job_id, technician_id), (selected, start) in choices.items():
            if solver.value(selected):
                at = solver.value(start)
                job = next(j for j in request.jobs if j.id == job_id)
                assignments.append(
                    {
                        "jobId": job_id,
                        "technicianId": technician_id,
                        "startMinute": at,
                        "endMinute": at + job.durationMinutes,
                    }
                )
    result = _summarize(request, assignments, perf_counter() - started, solver.status_name(status))
    result["objectiveValue"] = solver.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
    result["bestObjectiveBound"] = (
        solver.best_objective_bound if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
    )
    return result


def validate_assignments(request: OptimizationRequest, assignments: list[dict]) -> list[str]:
    """Independent output validator used by both strategies and tests."""
    jobs, technicians = {j.id: j for j in request.jobs}, {t.id: t for t in request.technicians}
    errors = []
    seen = set()
    occupied = {t.id: list(t.existingBookings) for t in request.technicians}
    for assignment in assignments:
        job_id, technician_id = assignment["jobId"], assignment["technicianId"]
        if job_id in seen:
            errors.append(f"Duplicate assignment for {job_id}")
        seen.add(job_id)
        if job_id not in jobs or technician_id not in technicians:
            errors.append("Unknown job or technician")
            continue
        job, technician = jobs[job_id], technicians[technician_id]
        start, end = assignment["startMinute"], assignment["endMinute"]
        if end - start != job.durationMinutes:
            errors.append(f"Wrong duration for {job_id}")
        if not any(lower <= start <= upper for lower, upper in candidate_bounds(technician, job)):
            errors.append(f"Qualification or hours violation for {job_id}")
        if any(overlaps(start, end, b) for b in occupied[technician_id]):
            errors.append(f"Overlap for {technician_id}/{job_id}")
        occupied[technician_id].append(Window(startMinute=start, endMinute=end))
    return errors


def dispatch(request: OptimizationRequest) -> dict:
    return baseline(request) if request.strategy == "baseline" else optimized(request)


def reproducible_scenario(seed: int = 360) -> OptimizationRequest:
    rng = np.random.default_rng(seed)
    technicians = [
        Technician(
            id=f"tech-{i:02d}",
            skills=["HVAC", "Heating"] if i % 2 else ["HVAC", "Cooling"],
            certifications=["EPA608"] if i % 3 else [],
            workingHours=Window(startMinute=480, endMinute=1020),
            availability=[Window(startMinute=480, endMinute=720), Window(startMinute=780, endMinute=1020)],
            existingBookings=[Window(startMinute=540 + i * 10, endMinute=590 + i * 10)] if i % 2 else [],
            workloadMinutes=i * 15,
            x=float(rng.uniform(0, 30)),
            y=float(rng.uniform(0, 30)),
        )
        for i in range(6)
    ]
    jobs = []
    for i in range(22):
        start = int(rng.choice([480, 540, 600, 780, 840, 900]))
        jobs.append(
            Job(
                id=f"job-{i:03d}",
                requiredSkills=[str(rng.choice(["HVAC", "Heating", "Cooling"]))],
                requiredCertifications=["EPA608"] if i % 4 == 0 else [],
                earliestStartMinute=start,
                latestEndMinute=min(start + 180, 1020),
                durationMinutes=int(rng.choice([45, 60, 90])),
                priority=str(rng.choice(["Normal", "High", "Critical"])),
                x=float(rng.uniform(0, 30)),
                y=float(rng.uniform(0, 30)),
            )
        )
    return OptimizationRequest(technicians=technicians, jobs=jobs, timeLimitSeconds=3)


def evaluate_scheduling() -> dict:
    scenario = reproducible_scenario()
    base = baseline(scenario.model_copy(update={"strategy": "baseline"}))
    advanced = optimized(scenario)
    return {
        "synthetic": True,
        "seed": 360,
        "jobs": len(scenario.jobs),
        "technicians": len(scenario.technicians),
        "baseline": base,
        "optimized": advanced,
    }

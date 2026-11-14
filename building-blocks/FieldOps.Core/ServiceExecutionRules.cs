namespace FieldOps.Core;

/// <summary>Version two distinguishes recorded observations from prerequisites for advancing work.</summary>
public static class ServiceExecutionRules
{
    public static void RequireProgression(Workflow workflow, int index, Dictionary<string, string> answers)
    {
        // Existing instances remain pinned to the immutable version-one contract.
        if (workflow.TemplateVersion < 2) return;
        string? Answer(string key) => answers.GetValueOrDefault(key);
        switch (index)
        {
            case 0 when Answer("readiness") != "Ready":
                throw new DomainException(409, "Confirm readiness before departure. Request assistance for missing equipment or information.");
            case 1 when Answer("travelStatus") != "Arrived" || Answer("siteAccess") != "Accessible":
                throw new DomainException(409, "Record arrival and accessible service location before inspection. Report delays or access problems through assistance.");
            case 4:
                if (Answer("partsStatus") == "Ordered") throw new DomainException(409, "Required parts are unavailable. Request assistance; a supervisor can pause work or approve a documented exception.");
                if (workflow.Stages[3].Answers.GetValueOrDefault("partsRequired") == "Yes" && Answer("partsStatus") == "Not Required")
                    throw new DomainException(409, "Diagnosis requires parts. Document the parts used or request assistance to review the scope.");
                break;
            case 5 when Answer("functionalTest") != "Pass" || Answer("safetyVerification") != "Pass" || Answer("equipmentOperational") != "Yes":
                throw new DomainException(409, "Quality and safety checks must pass before acceptance. Request supervisor review for unresolved equipment.");
            case 6 when Answer("customerInformed") != "Yes" || Answer("serviceAccepted") != "Yes":
                throw new DomainException(409, "Customer acknowledgment is pending. Request supervisor review for an approved exception.");
            case 7:
                if (workflow.Stages.Take(7).Any(x => x.Status is not ("Completed" or "Overridden")))
                    throw new DomainException(409, "Complete each required stage or obtain a recorded supervisor exception.");
                if (Answer("outcome") == "Resolved" && Answer("equipmentStatus") != "Operational")
                    throw new DomainException(409, "A resolved job must leave the equipment operational.");
                if ((Answer("outcome") != "Resolved" || Answer("equipmentStatus") != "Operational") && Answer("followUpRequired") != "Yes")
                    throw new DomainException(409, "Unresolved work requires a documented follow-up recommendation.");
                break;
        }
    }
}

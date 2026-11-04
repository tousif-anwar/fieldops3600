namespace FieldOps.Core;

/// <summary>Versioned, validated backend form configuration. Published versions remain immutable.</summary>
public static class Templates
{
    private static readonly Lazy<IReadOnlyDictionary<int, WorkflowTemplate>> Definitions = new(Load);
    public static WorkflowTemplate Default => Get(1);

    public static WorkflowTemplate Get(int version)
    {
        if (!Definitions.Value.TryGetValue(version, out var template))
            throw new DomainException(404, $"Workflow template version {version} is not available.");
        // Do not let a caller mutate the configured definition used by another instance.
        return template with
        {
            Stages = template.Stages.Select(stage => stage with
            {
                Fields = stage.Fields.Select(field => field with { Options = [.. field.Options] }).ToArray()
            }).ToArray()
        };
    }

    private static IReadOnlyDictionary<int, WorkflowTemplate> Load()
    {
        var assembly = typeof(Templates).Assembly;
        var versions = new Dictionary<int, WorkflowTemplate>();
        foreach (var resource in assembly.GetManifestResourceNames().Where(name => name.Contains(".WorkflowTemplates.", StringComparison.Ordinal) && name.EndsWith(".json", StringComparison.Ordinal)))
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(resource)!);
            var template = ParseDefinition(reader.ReadToEnd());
            if (!versions.TryAdd(template.Version, template)) throw new InvalidOperationException("Duplicate workflow template version.");
        }
        if (versions.Count == 0) throw new InvalidOperationException("No workflow templates were configured.");
        return versions;
    }

    public static WorkflowTemplate ParseDefinition(string json)
    {
        var template = Json.Read<WorkflowTemplate>(json);
        if (template is null || template.Version < 1 || template.Stages is not { Length: 8 })
            throw new InvalidOperationException("A template needs a positive version and eight ordered stages.");
        for (var index = 0; index < template.Stages.Length; index++)
        {
            var stage = template.Stages[index];
            if (stage.Index != index || string.IsNullOrWhiteSpace(stage.Name) || stage.Fields is not { Length: > 0 })
                throw new InvalidOperationException("Template stage indices, names and fields must be valid.");
            var previous = new Dictionary<string, FormField>(StringComparer.Ordinal);
            foreach (var field in stage.Fields)
            {
                if (string.IsNullOrWhiteSpace(field.Key) || string.IsNullOrWhiteSpace(field.Label) || field.Options is not { Length: > 0 }
                    || field.Options.Any(string.IsNullOrWhiteSpace) || field.Options.Distinct(StringComparer.Ordinal).Count() != field.Options.Length)
                    throw new InvalidOperationException("Template fields require names and distinct nonempty options.");
                if (field.ConditionField is not null && (!previous.TryGetValue(field.ConditionField, out var parent) || !parent.Options.Contains(field.ConditionValue, StringComparer.Ordinal)))
                    throw new InvalidOperationException("A conditional field must refer to an earlier allowed option.");
                if (!previous.TryAdd(field.Key, field)) throw new InvalidOperationException("Template field keys must be unique within a stage.");
            }
        }
        return template;
    }

    public static void Validate(int stageIndex, Dictionary<string, string> answers, int templateVersion = 1)
    {
        var template = Get(templateVersion);
        if (stageIndex < 0 || stageIndex >= template.Stages.Length) throw new DomainException(409, "Invalid stage.");
        var fields = template.Stages[stageIndex].Fields;
        foreach (var key in answers.Keys)
            if (!fields.Any(field => field.Key == key)) throw new DomainException(400, $"Unknown form field: {key}.");
        foreach (var field in fields)
        {
            var visible = field.ConditionField is null || (answers.TryGetValue(field.ConditionField, out var parent) && parent == field.ConditionValue);
            if (!visible)
            {
                if (answers.ContainsKey(field.Key)) throw new DomainException(400, $"Field {field.Key} does not apply to these answers.");
                continue;
            }
            if (!answers.TryGetValue(field.Key, out var value))
            {
                if (field.Required) throw new DomainException(400, $"Choose a value for {field.Label}.");
            }
            else if (!field.Options.Contains(value, StringComparer.Ordinal)) throw new DomainException(400, $"Invalid option for {field.Label}.");
        }
    }
}

import { Field, Input, Select, Textarea } from "@fluentui/react-components";
import type { FormField } from "../types";

export function answerError(field: FormField, raw = ""): string | null {
  const value = raw.trim();
  if (!value) return field.required ? `${field.label} is required.` : null;
  if (field.inputType === "text") {
    return field.maxLength != null && raw.length > field.maxLength
      ? `${field.label} must be at most ${field.maxLength} characters.`
      : null;
  }
  if (field.inputType === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) return `${field.label} must be a number.`;
    if (field.minimum != null && number < field.minimum)
      return `${field.label} must be at least ${field.minimum}.`;
    if (field.maximum != null && number > field.maximum)
      return `${field.label} must be at most ${field.maximum}.`;
    return null;
  }
  return field.options.includes(raw)
    ? null
    : `Choose an available answer for ${field.label}.`;
}

export function WorkflowAnswer({
  field,
  value,
  editable,
  onChange,
}: {
  field: FormField;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={field.label} required={field.required && editable}>
      {field.inputType === "text" ? (
        <Textarea
          autoComplete="off"
          value={value}
          required={field.required && editable}
          disabled={!editable}
          maxLength={field.maxLength ?? undefined}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.inputType === "number" ? (
        <Input
          autoComplete="off"
          type="number"
          value={value}
          required={field.required && editable}
          disabled={!editable}
          min={field.minimum ?? undefined}
          max={field.maximum ?? undefined}
          step="any"
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Select
          value={value}
          required={field.required && editable}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select an answer</option>
          {field.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}

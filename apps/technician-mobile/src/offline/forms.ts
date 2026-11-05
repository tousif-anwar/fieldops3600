import type { FormField } from '../contracts';

export const visibleFields = (fields: FormField[], answers: Record<string, string>) => fields.filter(
  field => !field.conditionField || answers[field.conditionField] === field.conditionValue,
);

export function validateField(field: FormField, answers: Record<string, string>): string | null {
  const answer = answers[field.key];
  if (!answer && field.required) return `Select ${field.label.toLowerCase()}.`;
  if (answer && !field.options.includes(answer)) return `${field.label} contains an invalid selection.`;
  return null;
}

export function validateAnswers(fields: FormField[], answers: Record<string, string>): string[] {
  return visibleFields(fields, answers).flatMap(field => {
    const message = validateField(field, answers);
    return message ? [message] : [];
  });
}

export function cleanAnswers(fields: FormField[], answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(visibleFields(fields, answers)
    .filter(field => answers[field.key])
    .map(field => [field.key, answers[field.key]!]));
}

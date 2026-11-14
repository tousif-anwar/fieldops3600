import type { FormField } from '../contracts';

export const visibleFields = (fields: FormField[], answers: Record<string, string>) => fields.filter(
  field => !field.conditionField || answers[field.conditionField] === field.conditionValue,
);

export function validateField(field: FormField, answers: Record<string, string>): string | null {
  const answer = answers[field.key]?.trim();
  const inputType = field.inputType ?? 'choice';
  if (!answer && field.required) return `${inputType === 'choice' ? 'Select' : 'Enter'} ${field.label.toLowerCase()}.`;
  if (!answer) return null;
  if (inputType === 'choice' && !field.options.includes(answer)) return `${field.label} contains an invalid selection.`;
  if (inputType !== 'choice' && answer.length > (field.maxLength ?? 2000))
    return `${field.label} must be at most ${field.maxLength ?? 2000} characters.`;
  if (inputType === 'number') {
    const number = Number(answer);
    if (!/^-?\d+(\.\d+)?$/.test(answer) || !Number.isFinite(number)) return `${field.label} must be a valid number.`;
    if (field.minimum != null && number < field.minimum) return `${field.label} must be at least ${field.minimum}.`;
    if (field.maximum != null && number > field.maximum) return `${field.label} must be at most ${field.maximum}.`;
  }
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
    .filter(field => answers[field.key]?.trim())
    .map(field => [field.key, answers[field.key]!.trim()]));
}

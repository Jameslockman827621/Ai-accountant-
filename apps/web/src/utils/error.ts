export function toError(value: unknown, fallbackMessage = 'Unexpected error'): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(fallbackMessage);
}

export function toErrorMessage(value: unknown, fallbackMessage = 'Unexpected error'): string {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return fallbackMessage;
}

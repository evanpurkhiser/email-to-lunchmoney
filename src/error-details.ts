const ERROR_DETAIL_KEYS = [
  'status',
  'code',
  'type',
  'param',
  'request_id',
  'requestID',
] as const;

export function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {value: String(error)};
  }

  const errorRecord = error as Error & Record<string, unknown>;
  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  for (const key of ERROR_DETAIL_KEYS) {
    const value = errorRecord[key];
    if (value !== undefined) {
      details[key] = value;
    }
  }

  return details;
}

export function getErrorMessage(error: unknown, fallback = "Άγνωστο σφάλμα") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timeout after ${ms}ms (${label})`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

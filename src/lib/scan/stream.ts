/** Client-side guard for the scan stream: a read that stays silent past the limit counts as a lost connection. */
export class StreamSilentError extends Error {}

/** Resolves with p, or rejects with StreamSilentError after ms of silence (the timer is always cleared). */
export async function withinSilence<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamSilentError("no data from the scan stream")), ms);
  });
  try {
    return await Promise.race([p, silence]);
  } finally {
    clearTimeout(timer);
  }
}

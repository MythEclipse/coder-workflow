/**
 * Batch runner utility with bounded concurrency.
 *
 * Exports:
 *   - DEFAULT_BATCH_CONCURRENCY = 4
 *   - MAX_BATCH_CONCURRENCY = 16
 *   - MAX_BATCH_ITEMS = 50
 *   - Interfaces: BatchRunOptions, BatchSuccess, BatchFailure, BatchResult, BatchOutput
 *   - runBatch<TInput,TResult>(items, options, worker)
 */

export const DEFAULT_BATCH_CONCURRENCY = 4;
export const MAX_BATCH_CONCURRENCY = 16;
export const MAX_BATCH_ITEMS = 50;

export interface BatchRunOptions {
  /** Desired concurrency, defaults to DEFAULT_BATCH_CONCURRENCY */
  concurrency?: number;
}

export interface BatchSuccess<TInput, TResult> {
  ok: true;
  index: number;
  input: TInput;
  output: TResult;
}

export interface BatchFailure<TInput> {
  ok: false;
  index: number;
  input: TInput;
  /** Error message string */
  error: string;
}

export type BatchResult<TInput, TResult> = BatchSuccess<TInput, TResult> | BatchFailure<TInput>;

export interface BatchOutput<TInput, TResult> {
  /** Concurrency that was actually used */
  concurrency: number;
  /** Total number of items processed */
  total: number;
  /** Number of successful results */
  succeeded: number;
  /** Number of failed results */
  failed: number;
  /** Results preserving original input order */
  results: BatchResult<TInput, TResult>[];
}

/**
 * Runs a batch of items through a worker function with bounded concurrency.
 *
 * The function validates the number of items and the requested concurrency, then
 * executes the worker for each item. Results are returned in the same order as the
 * input array, each wrapped in a success or failure object. Errors from the worker
 * do not abort the entire batch; they are captured and reported as failures.
 */
export async function runBatch<TInput, TResult>(
  items: TInput[],
  options: BatchRunOptions | undefined,
  worker: (item: TInput, index: number) => Promise<TResult> | TResult,
): Promise<BatchOutput<TInput, TResult>> {
  // Validate item count
  const total = items.length;
  if (total < 1 || total > MAX_BATCH_ITEMS) {
    throw new Error("Batch item count must be between 1 and 50.");
  }

  // Determine concurrency
  let concurrency = options?.concurrency ?? DEFAULT_BATCH_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_BATCH_CONCURRENCY) {
    throw new Error("concurrency must be an integer between 1 and 16.");
  }
  concurrency = Math.min(concurrency, total);

  const results: BatchResult<TInput, TResult>[] = new Array(total);
  let succeeded = 0;
  let failed = 0;

  // Helper to run a single item and store its result
  const runItem = async (idx: number) => {
    const input = items[idx];
    try {
      const output = await Promise.resolve(worker(input, idx));
      results[idx] = { ok: true, index: idx, input, output } as BatchSuccess<TInput, TResult>;
      succeeded++;
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      results[idx] = { ok: false, index: idx, input, error: errMsg } as BatchFailure<TInput>;
      failed++;
    }
  };

  // Run with bounded concurrency using a simple pool
  const pool: Promise<void>[] = [];
  let nextIdx = 0;

  const launch = async () => {
    while (nextIdx < total) {
      // Fill pool up to concurrency limit
      while (pool.length < concurrency && nextIdx < total) {
        const idx = nextIdx++;
        const p = runItem(idx).then(() => {
          // Remove completed promise from pool
          const i = pool.indexOf(p);
          if (i >= 0) pool.splice(i, 1);
        });
        pool.push(p);
      }
      // Wait for any running promise to settle before adding more
      if (pool.length >= concurrency) {
        await Promise.race(pool);
      }
    }
    // Wait for remaining work to finish
    await Promise.all(pool);
  };

  await launch();

  return {
    concurrency,
    total,
    succeeded,
    failed,
    results,
  };
}

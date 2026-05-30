import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BATCH_CONCURRENCY, runBatch } from "../src/batch.js";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

test("runBatch returns partial success and preserves input order", async () => {
  const inputs = [3, 1, 2];
  const worker = async (n: number) => {
    if (n === 1) throw new Error("bad");
    return delay(0, n * 2);
  };

  const result = await runBatch<number, number>(inputs, { concurrency: 2 }, worker);

  assert.equal(result.total, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    result.results.map((item) => item.index),
    [0, 1, 2],
  );
  assert.deepEqual(result.results[0], { ok: true, index: 0, input: 3, output: 6 });
  assert.deepEqual(result.results[1], { ok: false, index: 1, input: 1, error: "bad" });
  assert.deepEqual(result.results[2], { ok: true, index: 2, input: 2, output: 4 });
});

test("runBatch uses default concurrency", async () => {
  const inputs = [0, 1, 2, 3];
  const worker = async (n: number) => delay(10, n);

  const result = await runBatch<number, number>(inputs, undefined, worker);

  assert.equal(result.concurrency, DEFAULT_BATCH_CONCURRENCY);
  assert.equal(result.succeeded, 4);
  assert.equal(result.failed, 0);
});

test("runBatch rejects invalid concurrency and oversized batches", async () => {
  const items = Array.from({ length: 2 }, (_, index) => index);
  await assert.rejects(
    () => runBatch(items, { concurrency: 17 }, async () => undefined),
    /concurrency must be an integer between 1 and 16\./,
  );

  const many = Array.from({ length: 51 }, (_, index) => index);
  await assert.rejects(
    () => runBatch(many, undefined, async () => undefined),
    /Batch item count must be between 1 and 50\./,
  );
});

test("runBatch honors concurrency limit", async () => {
  const inputs = [1, 2, 3, 4, 5];
  let maxActive = 0;
  let current = 0;
  const worker = async (n: number) => {
    current++;
    if (current > maxActive) maxActive = current;
    await delay(20, n);
    current--;
    return n;
  };

  const result = await runBatch<number, number>(inputs, { concurrency: 2 }, worker);

  assert.equal(result.concurrency, 2);
  assert.equal(result.succeeded, 5);
  assert.ok(maxActive <= 2);
});

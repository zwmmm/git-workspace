const operations = new Map<
  string,
  { input: string; result: Promise<unknown> }
>();

export async function runOperation<T>(
  id: string,
  input: unknown,
  action: () => Promise<T>
): Promise<T> {
  const fingerprint = JSON.stringify(input);
  const previous = operations.get(id);
  if (previous) {
    if (previous.input !== fingerprint)
      throw new Error("操作参数已变化，请重新确认");
    return previous.result as Promise<T>;
  }
  const result = action().catch((error) => {
    operations.delete(id);
    throw error;
  });
  operations.set(id, { input: fingerprint, result });
  return result;
}

export async function readOperation<T>(id: string): Promise<T | null> {
  const operation = operations.get(id);
  return operation ? await operation.result as T : null;
}

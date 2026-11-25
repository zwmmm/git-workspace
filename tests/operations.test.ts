import { expect, test } from "vitest";
import { runOperation } from "../server/operations";

test("a retry of a pending operation and a retry after its completion reuse one result", async () => {
  let calls = 0,
    finish!: (value: string) => void;
  const create = () => {
    calls++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  const first = runOperation("test-create-one", { repo: "a" }, create);
  const retry = runOperation("test-create-one", { repo: "a" }, create);
  finish("workspace-one");
  expect(await first).toBe("workspace-one");
  expect(await retry).toBe("workspace-one");
  expect(await runOperation("test-create-one", { repo: "a" }, create)).toBe(
    "workspace-one"
  );
  expect(calls).toBe(1);
});

test("an operation identifier cannot be reused with different inputs", async () => {
  await runOperation("test-create-two", { repo: "a" }, async () => "one");
  await expect(
    runOperation("test-create-two", { repo: "b" }, async () => "two")
  ).rejects.toThrow("操作参数已变化");
});

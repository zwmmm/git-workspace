import { beforeEach, expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { readProjectState } from "../shared/projects";
let deleteProject: typeof import("../server/project-service")["deleteProject"];
let inspectProjectDeletion: typeof import("../server/project-service")["inspectProjectDeletion"];
beforeEach(async () => {
  vi.resetModules();
  ({ deleteProject, inspectProjectDeletion } = await import("../server/project-service"));
});

const descriptor = { projectId: "p", projectDisplayName: "demo", projectRootPath: "/Projects/demo", projectKind: "git" };
function fixture() {
  let projects = [descriptor];
  const paseo = {
    projects: { list: vi.fn(async () => ({ projects })) },
    workspaces: { list: vi.fn(async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } })) },
    agents: { list: vi.fn(async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } })) },
    terminals: { list: vi.fn(async () => ({ entries: [] })) },
  } as unknown as PaseoApi;
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === "daemon") return { stdout: JSON.stringify({ serverId: "host", home: "/daemon home", daemonVersion: "0.17.4", connectedDaemon: "reachable" }) };
    if (args.includes("--help")) return { stdout: "Usage: paseo project delete" };
    projects = [];
    return { stdout: JSON.stringify({ projectId: "p", removedWorkspaceIds: [] }) };
  });
  return { paseo, run, remove: () => { projects = []; } };
}

test("deletion uses the verified daemon home and succeeds only after project absence is confirmed", async () => {
  const { paseo, run } = fixture();
  const { projects } = await inspectProjectDeletion(paseo, { hostId: "host", projectIds: ["p"] }, run);
  const result = await deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: projects[0].snapshot }, run);
  expect(result.status).toBe("removed");
  expect(run).toHaveBeenCalledWith(["project", "delete", "p", "--home", "/daemon home", "--json"]);
});

test("a mismatched host never invokes project delete", async () => {
  const { paseo, run } = fixture();
  const result = await deleteProject(paseo, { hostId: "other", projectId: "p", snapshot: "" }, run);
  expect(result.status).toBe("skipped");
  expect(run.mock.calls.some(([args]) => args[0] === "project")).toBe(false);
});

test("a changed confirmation snapshot prevents mutation", async () => {
  const { paseo, run } = fixture();
  const result = await deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: "old" }, run);
  expect(result.status).toBe("skipped");
  expect(run.mock.calls.some(([args]) => args.includes("delete"))).toBe(false);
});

test("a lost CLI reply is reconciled instead of replaying a successful removal", async () => {
  const { paseo, run, remove } = fixture();
  const [project] = await readProjectState(paseo);
  const runner = vi.fn(async (args: string[]) => {
    if (args[0] === "daemon") return run(args);
    remove();
    throw new Error("connection lost");
  });
  expect((await deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: project.snapshot }, runner)).status).toBe("removed");
  expect(runner.mock.calls.filter(([args]) => args[0] === "project")).toHaveLength(1);
});

test("an unresolved mutation is reported as unknown and is never retried automatically", async () => {
  const { paseo, run } = fixture();
  const [project] = await readProjectState(paseo);
  const runner = vi.fn(async (args: string[]) => {
    if (args[0] === "daemon") return run(args);
    throw new Error("timed out");
  });
  expect((await deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: project.snapshot }, runner)).status).toBe("unknown");
  expect(runner.mock.calls.filter(([args]) => args[0] === "project")).toHaveLength(1);
});

test("concurrent delete requests for the same project cannot start two mutations", async () => {
  const { paseo, run, remove } = fixture();
  const [project] = await readProjectState(paseo);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const runner = vi.fn(async (args: string[]) => {
    if (args[0] === "daemon") return run(args);
    started(); await pending; remove(); return { stdout: "{}" };
  });
  const first = deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: project.snapshot }, runner);
  await ready;
  const second = deleteProject(paseo, { hostId: "host", projectId: "p", snapshot: project.snapshot }, runner);
  finish();
  const results = await Promise.all([first, second]);
  expect(results.map(r => r.status)).toEqual(["removed", "skipped"]);
  expect(runner.mock.calls.filter(([args]) => args[0] === "project")).toHaveLength(1);
});

test("unknown deletion remains protected across new operation attempts and confirmation requests", async () => {
  const { paseo, run } = fixture();
  const [project] = await readProjectState(paseo);
  const runner = vi.fn(async (args: string[]) => {
    if (args[0] === "daemon" || args.includes("--help")) return run(args);
    throw new Error("connection lost after submission");
  });
  const input = { hostId: "host", projectId: "p", snapshot: project.snapshot };
  await deleteProject(paseo, input, runner);
  expect((await deleteProject(paseo, input, runner)).status).toBe("unknown");
  await expect(inspectProjectDeletion(paseo, { hostId: "host", projectIds: ["p"] }, runner)).rejects.toThrow();
  expect(runner.mock.calls.filter(([args]) => args[0] === "project" && !args.includes("--help"))).toHaveLength(1);
});

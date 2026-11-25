import { expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { readProjectState } from "../shared/projects";

const project = { projectId: "p", projectDisplayName: "demo", projectCustomName: null,
  projectRootPath: "/Projects/demo", projectKind: "git" };
const workspace = { id: "w", projectId: "p", name: "main", workspaceDirectory: "/Projects/demo",
  status: "done", setupStatus: null, archivingAt: null, scripts: [], background: true };
const pageInfo = { hasMore: false, nextCursor: null, total: 1 };
function api(overrides: Record<string, unknown> = {}) {
  return {
    projects: { list: vi.fn().mockResolvedValue({ projects: [project, { ...project, projectId: "empty", projectDisplayName: "empty" }] }) },
    workspaces: { list: vi.fn().mockResolvedValue({ entries: [workspace], pageInfo }) },
    agents: { list: vi.fn().mockResolvedValue({ entries: [{ agent: { id: "a", workspaceId: "w", status: "idle", archivedAt: null } }], pageInfo }) },
    terminals: { list: vi.fn().mockResolvedValue({ entries: [] }) },
    ...overrides,
  } as unknown as PaseoApi;
}

test("registered empty projects are retained and background workspaces are counted", async () => {
  const paseo = api();
  const rows = await readProjectState(paseo);
  expect(rows.find(p => p.id === "empty")).toMatchObject({ workspaceCount: 0, blocked: null });
  expect(rows.find(p => p.id === "p")).toMatchObject({ workspaceCount: 1, agentCount: 1, blocked: null });
  expect(paseo.workspaces.list).toHaveBeenCalledWith(expect.objectContaining({ includeBackground: true }));
});

test("running background agents and terminals prevent project removal", async () => {
  const paseo = api({ agents: { list: vi.fn().mockResolvedValue({ entries: [{ agent: { id: "a", workspaceId: "w", status: "initializing", archivedAt: null } }], pageInfo }) } });
  expect((await readProjectState(paseo)).find(p => p.id === "p")?.blocked).toBe("running");
  const terminals = api({ terminals: { list: vi.fn().mockResolvedValue({ entries: [{ id: "t", workspaceId: "w", cwd: "/elsewhere", name: "shell" }] }) } });
  expect((await readProjectState(terminals)).find(p => p.id === "p")?.blocked).toBe("terminal");
});

test("workspace pagination and changed membership are reflected in confirmation snapshots", async () => {
  const list = vi.fn().mockResolvedValueOnce({ entries: [workspace], pageInfo: { hasMore: true, nextCursor: "next" } })
    .mockResolvedValueOnce({ entries: [{ ...workspace, id: "w2" }], pageInfo });
  const paseo = api({ workspaces: { list } });
  const rows = await readProjectState(paseo);
  expect(rows.find(p => p.id === "p")?.workspaceCount).toBe(2);
  expect(list.mock.calls[1][0].page.cursor).toBe("next");
  expect(rows.find(p => p.id === "p")?.snapshot).not.toBe((await readProjectState(api())).find(p => p.id === "p")?.snapshot);
});

test("an incomplete directory page never turns into a deletable empty project", async () => {
  const paseo = api({ workspaces: { list: vi.fn().mockResolvedValue({ entries: [], pageInfo: { hasMore: true, nextCursor: null } }) } });
  await expect(readProjectState(paseo)).rejects.toThrow();
});

test("idle agents with background work remain protected, using runningCount when present", async () => {
  for (const [backgroundWork, expected] of [[{ count: 2 }, "running"], [{ count: 2, runningCount: 1 }, "running"], [{ count: 2, runningCount: 0 }, null]] as const) {
    const paseo = api({ agents: { list: vi.fn().mockResolvedValue({ entries: [{ agent: { id: "a", workspaceId: "w", status: "idle", archivedAt: null, backgroundWork } }], pageInfo }) } });
    expect((await readProjectState(paseo)).find(p => p.id === "p")?.blocked).toBe(expected);
  }
});

test("historical sessions are associated by the daemon project identity even without active workspaces", async () => {
  const list = vi.fn().mockResolvedValue({ entries: [{ agent: { id: "old", status: "closed", archivedAt: "2026-01-01" }, project: { projectKey: "empty" } }], pageInfo });
  const rows = await readProjectState(api({ agents: { list } }));
  expect(rows.find(p => p.id === "empty")).toMatchObject({ workspaceCount: 0, agentCount: 1, blocked: null });
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ filter: expect.objectContaining({ includeArchived: true }) }));
});

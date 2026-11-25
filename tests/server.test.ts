import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const remote = vi.hoisted(() => ({
  github: vi.fn(),
  gitlab: vi.fn(),
  ghAuth: vi.fn(),
  glAuth: vi.fn(),
  root: "",
}));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  default: {
    ...(await original<typeof import("node:os")>()),
    homedir: () => remote.root,
  },
  homedir: () => remote.root,
}));
vi.mock("../server/git-service", async (original) => ({
  ...(await original<typeof import("../server/git-service")>()),
  fetchGitHubRepos: remote.github,
  fetchGitLabRepos: remote.gitlab,
  checkGitHubAuth: remote.ghAuth,
  checkGitLabAuth: remote.glAuth,
}));
let cache: typeof import("../server/cache-service")["repoCacheService"];
const repo = {
  id: "github:acme/app",
  name: "app",
  fullName: "acme/app",
  description: "App",
  url: "https://github.com/acme/app",
  sshUrl: "git@github.com:acme/app.git",
  httpUrl: "https://github.com/acme/app.git",
  defaultBranch: "main",
  provider: "github" as const,
  isPrivate: false,
  isLocal: false,
  localPath: "",
};
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  remote.root = await fs.mkdtemp(path.join(os.tmpdir(), "git-workspace-test-"));
  remote.github.mockResolvedValue([repo]);
  remote.gitlab.mockResolvedValue([]);
  remote.ghAuth.mockResolvedValue({
    installed: true,
    loggedIn: true,
    user: "tester",
  });
  remote.glAuth.mockResolvedValue({
    installed: true,
    loggedIn: true,
    user: "tester",
    host: "gitlab.com",
  });
  cache = (await import("../server/cache-service")).repoCacheService;
});
afterEach(async () => {
  cache.destroy();
  await fs.rm(remote.root, { recursive: true, force: true });
});

test("successful empty sync removes repositories no longer returned by the provider", async () => {
  await cache.syncAll();
  remote.github.mockResolvedValue([]);
  await cache.syncAll();
  expect((await cache.getRepos({ provider: "all" })).repos).toEqual([]);
});

test("failed source retains cached repositories and its last successful timestamp", async () => {
  await cache.syncAll();
  const before = await cache.getRepos({ provider: "github" });
  await new Promise((r) => setTimeout(r, 5));
  remote.github.mockRejectedValue(new Error("GitHub offline"));
  const result = await cache.syncAll();
  const after = await cache.getRepos({ provider: "github" });
  expect(after.repos.map((r) => r.fullName)).toEqual(["acme/app"]);
  expect(after.lastSyncedAt).toBe(before.lastSyncedAt);
  expect(result).toMatchObject({
    errors: [expect.stringContaining("GitHub offline")],
  });
});

test("concurrent sync callers wait for the actual sync result", async () => {
  let finish!: (value: (typeof repo)[]) => void;
  remote.github.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const first = cache.syncAll();
  const second = cache.syncAll();
  let settled = false;
  void second.then(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 5));
  expect(settled).toBe(false);
  finish([repo]);
  expect(await second).toEqual(await first);
});

test("failed workspace creation can retry using the already cloned repository", async () => {
  const actual = await vi.importActual<typeof import("../server/git-service")>(
    "../server/git-service"
  );
  const source = path.join(remote.root, "source");
  await fs.mkdir(source);
  execFileSync("git", ["init", "-b", "main", source]);
  execFileSync("git", [
    "-C",
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  ]);
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("workspace unavailable"))
    .mockResolvedValue({ id: "workspace-test" });
  const paseo = { workspaces: { create } } as unknown as Parameters<
    typeof actual.cloneAndCreateWorkspace
  >[1];
  const input = {
    provider: "github" as const,
    repoFullName: "acme/app",
    cloneUrl: source,
    cloneDir: path.join(remote.root, "clones"),
    branch: "main",
    isolation: "local" as const,
  };
  await expect(actual.cloneAndCreateWorkspace(input, paseo)).rejects.toThrow(
    "workspace unavailable"
  );
  await fs.rename(source, path.join(remote.root, "removed-source"));
  const result = await actual.cloneAndCreateWorkspace(input, paseo);
  expect(result.workspaceId).toBe("workspace-test");
  expect(create.mock.calls[1][0].source).toEqual({
    kind: "directory",
    path: path.join(remote.root, "clones/github.com/acme/app"),
  });
  await actual.cloneAndCreateWorkspace(
    { ...input, isolation: "worktree" },
    paseo
  );
  expect(create.mock.calls[2][0].source).toEqual({
    kind: "worktree",
    cwd: path.join(remote.root, "clones/github.com/acme/app"),
    action: "checkout",
    refName: "main",
  });
});

test("background sync reads updated host settings instead of capturing defaults", async () => {
  vi.useFakeTimers();
  let config = {
    gitlabUrl: "https://first.example.com",
    cloneDir: path.join(remote.root, "one"),
  };
  try {
    await cache.init(async () => config);
    await vi.advanceTimersByTimeAsync(500);
    await cache.syncAll(config.gitlabUrl, config.cloneDir);
    expect(remote.gitlab).toHaveBeenCalledWith(
      undefined,
      "https://first.example.com",
      path.join(remote.root, "one")
    );
    config = {
      gitlabUrl: "https://second.example.com",
      cloneDir: path.join(remote.root, "two"),
    };
    await vi.advanceTimersByTimeAsync(180000);
    expect(remote.gitlab).toHaveBeenLastCalledWith(
      undefined,
      "https://second.example.com",
      path.join(remote.root, "two")
    );
    await cache.syncAll(config.gitlabUrl, config.cloneDir);
  } finally {
    vi.useRealTimers();
  }
});

test("workspace creation rejects repository names that escape the clone root", async () => {
  const actual = await vi.importActual<typeof import("../server/git-service")>(
    "../server/git-service"
  );
  const paseo = { workspaces: { create: vi.fn() } } as unknown as Parameters<
    typeof actual.cloneAndCreateWorkspace
  >[1];
  await expect(
    actual.cloneAndCreateWorkspace(
      {
        provider: "github",
        repoFullName: "../outside",
        cloneUrl: "invalid",
        isolation: "local",
        cloneDir: remote.root,
      },
      paseo
    )
  ).rejects.toThrow("仓库路径");
});

test("a failed first sync stays idle until an explicit or scheduled retry", async () => {
  remote.github.mockRejectedValue(new Error("offline"));
  remote.gitlab.mockRejectedValue(new Error("offline"));
  await cache.syncAll();
  await cache.getRepos({ provider: "all" });
  expect(remote.github).toHaveBeenCalledTimes(1);
  expect((await cache.getRepos({ provider: "all" })).isSyncing).toBe(false);
});

test("queued callers for a new host all await that hosts own sync", async () => {
  let finishA!: (x: never[]) => void, finishB!: (x: never[]) => void;
  remote.gitlab.mockImplementation(
    (_q: unknown, url: string) =>
      new Promise((resolve) => {
        if (url.includes("a.example")) finishA = resolve;
        else finishB = resolve;
      })
  );
  const a = cache.syncAll("https://a.example");
  const b1 = cache.syncAll("https://b.example");
  const b2 = cache.syncAll("https://b.example");
  let settled = false;
  void b2.then(() => {
    settled = true;
  });
  finishA([]);
  await a;
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(settled).toBe(false);
  finishB([]);
  expect(await b1).toEqual(await b2);
});

test("GitLab instance parsing preserves explicit ports", async () => {
  const actual = await vi.importActual<typeof import("../server/git-service")>(
    "../server/git-service"
  );
  expect(actual.parseGitLabHost("https://git.example.com:8443/")).toBe(
    "git.example.com:8443"
  );
});

test("newly created repository is available before the next source sync", async () => {
  remote.github.mockResolvedValue([]);
  await cache.syncAll();
  await cache.rememberCreated(repo, "https://gitlab.com");
  expect(
    (await cache.getRepos({ provider: "github" })).repos.map((r) => r.fullName)
  ).toEqual(["acme/app"]);
});

import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import * as service from "../server/repository-service";

let root: string;
let originalPath: string | undefined;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repos-service-"));
  originalPath = process.env.PATH;
  const script = `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.REPOS_TEST_LOG,JSON.stringify(a)+'\\n');
if(a.includes('user')){console.log(JSON.stringify({login:'alice',username:'alice',id:7}));process.exit()}
if(a.includes('POST')){if(process.env.REPOS_TEST_FAIL==='conflict'){console.error('HTTP 422: name already exists');process.exit(1)}if(process.env.REPOS_TEST_FAIL==='yes'){console.error('network timeout');process.exit(1)}console.log(JSON.stringify({full_name:'alice/demo',name:'demo',html_url:'https://github.com/alice/demo',clone_url:'https://github.com/alice/demo.git',ssh_url:'git@github.com:alice/demo.git',default_branch:'trunk',private:true,path_with_namespace:'alice/demo',web_url:'https://git.example.com/alice/demo',ssh_url_to_repo:'git@git.example.com:alice/demo.git',http_url_to_repo:'https://git.example.com/alice/demo.git',visibility:'private'}));process.exit()}
if(process.env.REPOS_TEST_FAIL==='yes'){console.log(JSON.stringify({full_name:'alice/demo',name:'demo',html_url:'https://github.com/alice/demo',clone_url:'https://github.com/alice/demo.git',ssh_url:'git@github.com:alice/demo.git',default_branch:'trunk',private:true}));process.exit()}
console.error('404');process.exit(1);
`;
  for (const cli of ["gh", "glab"])
    await fs.writeFile(path.join(root, cli), script, { mode: 0o755 });
  process.env.PATH = root + path.delimiter + originalPath;
  process.env.REPOS_TEST_LOG = path.join(root, "calls");
  delete process.env.REPOS_TEST_FAIL;
});
afterEach(async () => {
  process.env.PATH = originalPath;
  delete process.env.REPOS_TEST_LOG;
  delete process.env.REPOS_TEST_FAIL;
  await fs.rm(root, { recursive: true, force: true });
});
const settings = () => ({
  cloneDir: path.join(root, "clones"),
  gitlabUrl: "https://git.example.com",
  cloneProtocol: "ssh" as const,
  defaultIsolation: "worktree" as const,
});

test("new GitHub repository uses authenticated owner, private visibility and initialized README", async () => {
  const result = await service.createRepository(
    { provider: "github", name: "demo", isPublic: false },
    settings()
  );
  expect(result.repo.fullName).toBe("alice/demo");
  expect(result.repo.defaultBranch).toBe("trunk");
  expect(result.uncertain).toBe(false);
  const calls = (await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x) as string[]);
  expect(calls.find((a) => a.includes("POST"))).toEqual(
    expect.arrayContaining([
      "user/repos",
      "name=demo",
      "private=true",
      "auto_init=true",
    ])
  );
});
test("new GitLab repository targets configured host and personal namespace", async () => {
  const result = await service.createRepository(
    { provider: "gitlab", name: "demo", isPublic: true },
    settings()
  );
  expect(result.repo.fullName).toBe("alice/demo");
  const calls = (await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x) as string[]);
  expect(calls.find((a) => a.includes("POST"))).toEqual(
    expect.arrayContaining([
      "projects",
      "--hostname",
      "git.example.com",
      "visibility=public",
      "initialize_with_readme=true",
    ])
  );
});
test("uncertain creation requires explicit reuse of found repository rather than a second POST", async () => {
  process.env.REPOS_TEST_FAIL = "yes";
  const result = await service.createRepository(
    { provider: "github", name: "demo", isPublic: false },
    settings()
  );
  expect(result.uncertain).toBe(true);
  expect(result.repo.fullName).toBe("alice/demo");
});
test("nonempty target folder prevents remote creation", async () => {
  const target = path.join(root, "clones/github.com/alice/demo");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, "keep.txt"), "keep");
  await expect(
    service.createRepository(
      { provider: "github", name: "demo", isPublic: false },
      settings()
    )
  ).rejects.toThrow();
  const calls = await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8");
  expect(calls).not.toContain("POST");
});
test("folder inspection rejects files and detects Git without changing directory content", async () => {
  const folder = path.join(root, "local");
  await fs.mkdir(folder);
  execFileSync("git", ["init", "-b", "main", folder]);
  const result = await service.inspectFolder(folder);
  expect(result.kind).toBe("git");
  expect(result.path).toBe(await fs.realpath(folder));
  const file = path.join(root, "file");
  await fs.writeFile(file, "x");
  await expect(service.inspectFolder(file)).rejects.toThrow();
});
test("import opens existing workspace for symlink without creating a duplicate", async () => {
  const folder = path.join(root, "local");
  await fs.mkdir(folder);
  const alias = path.join(root, "alias");
  await fs.symlink(folder, alias);
  let creates = 0;
  const paseo = {
    workspaces: {
      list: async () => ({
        entries: [{ id: "existing", workspaceDirectory: folder }],
      }),
      create: async () => {
        creates++;
        return { id: "new" };
      },
    },
  } as unknown as Parameters<typeof service.importFolder>[1];
  const result = await service.importFolder(alias, paseo);
  expect(result.workspaceId).toBe("existing");
  expect(creates).toBe(0);
});
test("plain folder import uses original directory without initializing Git", async () => {
  const folder = path.join(root, "notes");
  await fs.mkdir(folder);
  let received: unknown;
  const paseo = {
    workspaces: {
      list: async () => ({ entries: [] }),
      create: async (input: unknown) => {
        received = input;
        return { id: "new" };
      },
    },
  } as unknown as Parameters<typeof service.importFolder>[1];
  const result = await service.importFolder(folder, paseo);
  expect(result.title).toBe("notes");
  expect(received).toEqual({
    title: "notes",
    source: { kind: "directory", path: await fs.realpath(folder) },
  });
  await expect(fs.stat(path.join(folder, ".git"))).rejects.toThrow();
});

test("an explicit name conflict is reported instead of being treated as an uncertain creation", async () => {
  process.env.REPOS_TEST_FAIL = "conflict";
  await expect(
    service.createRepository(
      { provider: "github", name: "demo", isPublic: false },
      settings()
    )
  ).rejects.toThrow("已存在");
});

test("import searches remaining workspace pages before creating a duplicate", async () => {
  const folder = path.join(root, "local");
  await fs.mkdir(folder);
  let creates = 0;
  const paseo = {
    workspaces: {
      list: async (options: { page?: { cursor?: string } }) =>
        options.page?.cursor === "next"
          ? {
              entries: [{ id: "existing", workspaceDirectory: folder }],
              pageInfo: { hasMore: false, nextCursor: null },
            }
          : { entries: [], pageInfo: { hasMore: true, nextCursor: "next" } },
      create: async () => {
        creates++;
        return { id: "new" };
      },
    },
  } as unknown as Parameters<typeof service.importFolder>[1];
  const result = await service.importFolder(folder, paseo);
  expect(result.workspaceId).toBe("existing");
  expect(creates).toBe(0);
});

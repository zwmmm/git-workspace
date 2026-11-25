import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import * as service from "../server/repository-service";

let root: string;
let originalPath: string | undefined;
let originalGhHost: string | undefined;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "repos-service-"));
  originalPath = process.env.PATH;
  originalGhHost = process.env.GH_HOST;
  const script = `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.REPOS_TEST_LOG,JSON.stringify(a)+'\\n');
if(a.some(x=>x.startsWith('projects?'))&&process.env.REPOS_TEST_FAIL==='invalid-json'){console.log(JSON.stringify({message:'unexpected'}));process.exit()}
if(a.includes('graphql')){
 const q=a.find(x=>x.startsWith('query='))||'';
 if(process.env.REPOS_TEST_FAIL==='groups-error'){console.log(JSON.stringify({errors:[{message:'permission unavailable'}]}));process.exit()}
 if(q.includes('group(fullPath:')){console.log(JSON.stringify({data:{group:{id:'gid://gitlab/Group/42',name:'tools',fullPath:'team/tools',userPermissions:{createProjects:process.env.REPOS_TEST_FAIL!=='group-denied'}}}}));process.exit()}
 const second=q.includes('after:');
 console.log(JSON.stringify({data:{groups:{nodes:second?[{id:'gid://gitlab/Group/42',name:'tools',fullPath:'team/tools',userPermissions:{createProjects:true}}]:[{id:'gid://gitlab/Group/5',name:'root',fullPath:'team',userPermissions:{createProjects:false}}],pageInfo:{hasNextPage:!second,endCursor:second?null:'next'}}}}));process.exit()
}
if(a.includes('user')){console.log(JSON.stringify({login:'alice',username:'alice',id:7}));process.exit()}
if(a.includes('POST')){if(process.env.REPOS_TEST_FAIL==='conflict'){console.error('HTTP 422: name already exists');process.exit(1)}if(process.env.REPOS_TEST_FAIL==='yes'){console.error('network timeout');process.exit(1)}console.log(JSON.stringify({full_name:'alice/demo',name:'demo',html_url:'https://github.com/alice/demo',clone_url:'https://github.com/alice/demo.git',ssh_url:'git@github.com:alice/demo.git',default_branch:'trunk',private:true,path_with_namespace:a.includes('namespace_id=42')?'team/tools/demo':'alice/demo',web_url:'https://git.example.com/'+(a.includes('namespace_id=42')?'team/tools/demo':'alice/demo'),ssh_url_to_repo:'git@git.example.com:'+(a.includes('namespace_id=42')?'team/tools/demo':'alice/demo')+'.git',http_url_to_repo:'https://git.example.com/'+(a.includes('namespace_id=42')?'team/tools/demo':'alice/demo')+'.git',visibility:'private'}));process.exit()}
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
  if (originalGhHost === undefined) delete process.env.GH_HOST;
  else process.env.GH_HOST = originalGhHost;
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

test("concurrent imports of one real directory share the same workspace creation", async () => {
  const folder = path.join(root, "local");
  await fs.mkdir(folder);
  let creates = 0;
  const paseo = {
    workspaces: {
      list: async () => ({ entries: [] }),
      create: async () => {
        creates++;
        await new Promise((r) => setTimeout(r, 10));
        return { id: "shared" };
      },
    },
  } as unknown as Parameters<typeof service.importFolder>[1];
  const [first, second] = await Promise.all([
    service.importFolder(folder, paseo),
    service.importFolder(folder, paseo),
  ]);
  expect(creates).toBe(1);
  expect(first.workspaceId).toBe(second.workspaceId);
});

test("GitHub creation explicitly targets github.com even when another GH_HOST is configured", async () => {
  process.env.GH_HOST = "enterprise.example.com";
  await service.createRepository(
    { provider: "github", name: "demo", isPublic: false },
    settings()
  );
  const calls = (await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x) as string[]);
  expect(
    calls.every((a) => a.includes("--hostname") && a.includes("github.com"))
  ).toBe(true);
});

test("account changes after confirmation reject the write before creating a repository", async () => {
  await expect(
    service.createRepository(
      {
        provider: "github",
        name: "demo",
        isPublic: false,
        expectedOwner: "bob",
      },
      settings()
    )
  ).rejects.toThrow("账户已变化");
  expect(await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8")).not.toContain(
    "POST"
  );
});

test("malformed provider JSON is a source failure rather than a successful empty list", async () => {
  process.env.REPOS_TEST_FAIL = "invalid-json";
  const { fetchGitLabRepos } = await import("../server/git-service");
  await expect(
    fetchGitLabRepos(undefined, "https://git.example.com", root)
  ).rejects.toThrow("无效的仓库列表");
});

test("GitLab group discovery follows pagination and returns only permitted complete paths", async () => {
  const groups = await service.listGitLabGroups(settings());
  expect(groups).toEqual([{ id: 42, name: "tools", fullPath: "team/tools" }]);
  const calls = (await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x) as string[]);
  expect(calls.filter((a) => a.includes("graphql"))).toHaveLength(2);
});

test("a selected GitLab group sets namespace_id and uses the nested group path", async () => {
  const result = await service.createRepository(
    {
      provider: "gitlab",
      name: "demo",
      isPublic: false,
      namespaceId: 42,
      namespacePath: "team/tools",
    },
    settings()
  );
  expect(result.repo.fullName).toBe("team/tools/demo");
  expect(result.repo.httpUrl).toBe(
    "https://git.example.com/team/tools/demo.git"
  );
  expect(result.repo.localPath).toBe(
    path.join(root, "clones/git.example.com/team/tools/demo")
  );
  const calls = (await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8"))
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x) as string[]);
  expect(calls.find((a) => a.includes("POST"))).toContain("namespace_id=42");
});

test("lost group creation permission rejects the write without creating a personal repository", async () => {
  process.env.REPOS_TEST_FAIL = "group-denied";
  await expect(
    service.createRepository(
      {
        provider: "gitlab",
        name: "demo",
        isPublic: false,
        namespaceId: 42,
        namespacePath: "team/tools",
      },
      settings()
    )
  ).rejects.toThrow("分组");
  expect(await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8")).not.toContain(
    "POST"
  );
});

test("GitLab group query errors remain errors instead of an empty permission list", async () => {
  process.env.REPOS_TEST_FAIL = "groups-error";
  await expect(service.listGitLabGroups(settings())).rejects.toThrow(
    "permission unavailable"
  );
});

test("a renamed GitLab group must be selected again instead of silently changing the target path", async () => {
  await expect(
    service.createRepository(
      {
        provider: "gitlab",
        name: "demo",
        isPublic: false,
        namespaceId: 42,
        namespacePath: "team/old-tools",
      },
      settings()
    )
  ).rejects.toThrow("分组已变化");
  expect(await fs.readFile(process.env.REPOS_TEST_LOG!, "utf8")).not.toContain(
    "POST"
  );
});

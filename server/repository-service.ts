import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { GitLabGroup, RepoItem } from "../shared/contracts";
import type { GitWorkspaceSettings } from "../shared/settings";
import { parseGitLabHost, resolveCloneDir } from "./git-service";

const exec = promisify(execFile);
const commandOptions = { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 };

async function api(
  provider: "github" | "gitlab",
  host: string,
  args: string[]
) {
  const { stdout } = await exec(
    provider === "github" ? "gh" : "glab",
    ["api", ...args, "--hostname", host],
    commandOptions
  );
  return JSON.parse(stdout);
}

const groupNodeSchema = z.object({
  id: z.string().regex(/^gid:\/\/gitlab\/Group\/\d+$/),
  name: z.string(),
  fullPath: z.string().min(1),
  userPermissions: z.object({ createProjects: z.boolean() }),
});
const groupFields = "id name fullPath userPermissions { createProjects }";

async function groupQuery(settings: GitWorkspaceSettings, query: string) {
  const result = await api("gitlab", parseGitLabHost(settings.gitlabUrl), [
    "graphql",
    "--raw-field",
    `query=${query}`,
  ]);
  if (Array.isArray(result.errors) && result.errors.length) {
    throw new Error(
      result.errors
        .map(
          (error: { message?: string }) =>
            error.message || "GitLab 分组查询失败"
        )
        .join("; ")
    );
  }
  return result.data;
}

export async function listGitLabGroups(
  settings: GitWorkspaceSettings
): Promise<GitLabGroup[]> {
  const groups: GitLabGroup[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const data = await groupQuery(
      settings,
      `query { groups(first: 100${
        cursor ? `, after: ${JSON.stringify(cursor)}` : ""
      }) { nodes { ${groupFields} } pageInfo { hasNextPage endCursor } } }`
    );
    const page = z
      .object({
        nodes: z.array(groupNodeSchema),
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
      })
      .parse(data?.groups);
    for (const node of page.nodes) {
      const id = Number(node.id.split("/").pop());
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error("GitLab 分组 ID 无效");
      if (node.userPermissions.createProjects)
        groups.push({ id, name: node.name, fullPath: node.fullPath });
    }
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && (!cursor || seen.has(cursor)))
      throw new Error("GitLab 分组分页信息无效");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return groups.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

export async function createRepository(
  input: {
    provider: "github" | "gitlab";
    name: string;
    isPublic: boolean;
    expectedOwner?: string;
    namespaceId?: number;
    namespacePath?: string;
  },
  settings: GitWorkspaceSettings
): Promise<{ repo: RepoItem; uncertain: boolean }> {
  const name = input.name.trim();
  if (
    !/^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("请输入有效的仓库名称，不包含路径");
  }
  const host =
    input.provider === "github"
      ? "github.com"
      : parseGitLabHost(settings.gitlabUrl);
  const user = await api(input.provider, host, ["user"]);
  const owner: string =
    input.provider === "github" ? user.login : user.username;
  if (!owner) throw new Error("无法识别已登录账户，请重新登录后重试");
  if (input.expectedOwner && input.expectedOwner !== owner)
    throw new Error("登录账户已变化，请重新打开表单确认");
  let namespace = owner;
  if (input.namespaceId !== undefined || input.namespacePath !== undefined) {
    if (
      input.provider !== "gitlab" ||
      !input.namespaceId ||
      !input.namespacePath
    )
      throw new Error("请选择有效的 GitLab 分组");
    const data = await groupQuery(
      settings,
      `query { group(fullPath: ${JSON.stringify(
        input.namespacePath
      )}) { ${groupFields} } }`
    );
    const parsed = groupNodeSchema.safeParse(data?.group);
    if (
      !parsed.success ||
      Number(parsed.data.id.split("/").pop()) !== input.namespaceId ||
      parsed.data.fullPath !== input.namespacePath ||
      !parsed.data.userPermissions.createProjects
    )
      throw new Error("分组已变化或没有创建项目的权限，请重新选择");
    namespace = parsed.data.fullPath;
  }
  const fullName = `${namespace}/${name}`;
  const localPath = path.join(
    resolveCloneDir(settings.cloneDir),
    host,
    fullName
  );
  try {
    if ((await fs.readdir(localPath)).length)
      throw new Error("目标文件夹非空，请更换仓库名称或克隆根目录");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const github = input.provider === "github";
  const readArgs = [
    github ? `repos/${fullName}` : `projects/${encodeURIComponent(fullName)}`,
  ];
  // A POST error can mean a timeout after creation. Return the found repository only
  // as uncertain; the client requires explicit confirmation before using it.
  let result;
  let uncertain = false;
  try {
    result = await api(
      input.provider,
      host,
      github
        ? [
            "user/repos",
            "--method",
            "POST",
            "--raw-field",
            `name=${name}`,
            "--field",
            `private=${!input.isPublic}`,
            "--field",
            "auto_init=true",
          ]
        : [
            "projects",
            "--method",
            "POST",
            "--raw-field",
            `name=${name}`,
            "--raw-field",
            `path=${name}`,
            "--raw-field",
            `visibility=${input.isPublic ? "public" : "private"}`,
            "--field",
            "initialize_with_readme=true",
            ...(input.namespaceId
              ? ["--field", `namespace_id=${input.namespaceId}`]
              : []),
          ]
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP[ :()]*4\d\d|already exists|already been taken/i.test(message)) {
      if (/422|409|already exists|already been taken/i.test(message))
        throw new Error("仓库名称已存在或不符合平台要求，请修改后重试");
      throw error;
    }
    try {
      result = await api(input.provider, host, readArgs);
      uncertain = true;
    } catch {
      throw error;
    }
  }
  const actualName = github ? result.full_name : result.path_with_namespace;
  if (
    typeof actualName !== "string" ||
    actualName.toLowerCase() !== fullName.toLowerCase()
  ) {
    throw new Error("平台返回的仓库与当前账户或名称不一致，请检查后重试");
  }
  return {
    uncertain,
    repo: {
      id: github ? `github:${actualName}` : `gitlab:${host}:${actualName}`,
      provider: input.provider,
      name: result.name,
      fullName: actualName,
      description: result.description || "",
      url: github ? result.html_url : result.web_url,
      sshUrl: github ? result.ssh_url : result.ssh_url_to_repo,
      httpUrl: github ? result.clone_url : result.http_url_to_repo,
      defaultBranch: result.default_branch || "",
      isPrivate: github ? result.private : result.visibility !== "public",
      isLocal: false,
      localPath,
    },
  };
}

export async function inspectFolder(input: string) {
  const directory = resolveCloneDir(input);
  const realPath = await fs.realpath(directory);
  if (!(await fs.stat(realPath)).isDirectory()) throw new Error("请选择文件夹");
  await fs.access(realPath, fs.constants.R_OK | fs.constants.X_OK);
  let kind: "git" | "directory" = "directory";
  try {
    await exec(
      "git",
      ["-C", realPath, "rev-parse", "--show-toplevel"],
      commandOptions
    );
    kind = "git";
  } catch {
    /* A plain folder is a valid project. */
  }
  return { path: realPath, kind, name: path.basename(realPath) || realPath };
}

export async function browseFolders(input?: string) {
  const folder = await inspectFolder(input || "~");
  const entries = await fs.readdir(folder.path, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(folder.path, entry.name);
    try {
      if (
        entry.isDirectory() ||
        (entry.isSymbolicLink() && (await fs.stat(fullPath)).isDirectory())
      ) {
        directories.push({ name: entry.name, path: fullPath });
      }
    } catch {
      /* Ignore inaccessible children; choosing an explicit path still reports errors. */
    }
  }
  return {
    path: folder.path,
    parent: path.dirname(folder.path),
    directories: directories.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const pendingImports = new Map<
  string,
  Promise<{ workspaceId: string; title: string; localPath: string }>
>();

export async function importFolder(
  input: string,
  paseo: PluginHandlerContext["paseo"],
  operationId?: string
) {
  if (!input.trim()) throw new Error("请选择文件夹");
  const folder = await inspectFolder(input);
  const pending = pendingImports.get(folder.path);
  if (pending) return pending;
  const result = findOrCreateFolder(folder, paseo, operationId);
  pendingImports.set(folder.path, result);
  try {
    return await result;
  } finally {
    if (pendingImports.get(folder.path) === result)
      pendingImports.delete(folder.path);
  }
}

async function findOrCreateFolder(
  folder: Awaited<ReturnType<typeof inspectFolder>>,
  paseo: PluginHandlerContext["paseo"],
  operationId?: string
) {
  let cursor: string | undefined;
  do {
    const result = await paseo.workspaces.list({
      page: { limit: 100, cursor },
    });
    for (const workspace of result.entries) {
      if (!workspace.workspaceDirectory) continue;
      try {
        if ((await fs.realpath(workspace.workspaceDirectory)) === folder.path) {
          return {
            workspaceId: workspace.id,
            title: folder.name,
            localPath: folder.path,
          };
        }
      } catch {
        /* Removed workspace directories cannot match this folder. */
      }
    }
    cursor = result.pageInfo?.hasMore
      ? result.pageInfo.nextCursor || undefined
      : undefined;
  } while (cursor);
  const workspace = await paseo.workspaces.create({
    ...(operationId ? { idempotencyKey: operationId } : {}),
    title: folder.name,
    source: { kind: "directory", path: folder.path },
  });
  return {
    workspaceId: workspace.id,
    title: folder.name,
    localPath: folder.path,
  };
}

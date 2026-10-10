import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RepoItem } from "../shared/contracts";

const exec = promisify(execFile);

export function parseGitLabHost(urlOrHost?: string): string {
  if (!urlOrHost || !urlOrHost.trim()) return "gitlab.com";
  const raw = urlOrHost.trim();
  const match = raw.match(/^(?:https?:\/\/)?([^/:]+)(?::\d+)?/);
  if (match && match[1]) {
    return match[1];
  }
  return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function resolveCloneDir(dir?: string): string {
  const d = dir?.trim() || "~/Projects";
  if (d.startsWith("~")) {
    return path.join(os.homedir(), d.slice(1));
  }
  return path.resolve(d);
}

export async function checkGitHubAuth(): Promise<{
  installed: boolean;
  loggedIn: boolean;
  user?: string;
  error?: string;
}> {
  try {
    const { stdout, stderr } = await exec("gh", ["auth", "status"]);
    const output = `${stdout}\n${stderr}`;
    const userMatch = output.match(/Logged in to [^ ]+ account ([^ (]+)/i);
    return {
      installed: true,
      loggedIn: true,
      user: userMatch ? userMatch[1] : undefined,
    };
  } catch (err: unknown) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(err.stderr)
        : err instanceof Error
          ? err.message
          : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "";
    if (code === "ENOENT") {
      return {
        installed: false,
        loggedIn: false,
        error: "GitHub CLI (gh) 未安装",
      };
    }
    return {
      installed: true,
      loggedIn: false,
      error: stderr.trim() || "GitHub CLI 未登录",
    };
  }
}

export async function checkGitLabAuth(gitlabUrl?: string): Promise<{
  installed: boolean;
  loggedIn: boolean;
  host: string;
  user?: string;
  error?: string;
}> {
  const host = parseGitLabHost(gitlabUrl);
  try {
    const { stdout, stderr } = await exec("glab", ["auth", "status", "--hostname", host]);
    const output = `${stdout}\n${stderr}`;
    const userMatch = output.match(/Logged in to [^ ]+ as ([^ (]+)/i);
    return {
      installed: true,
      loggedIn: true,
      host,
      user: userMatch ? userMatch[1] : undefined,
    };
  } catch (err: unknown) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String(err.stderr)
        : err instanceof Error
          ? err.message
          : String(err);
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String(err.code)
        : "";
    if (code === "ENOENT") {
      return {
        installed: false,
        loggedIn: false,
        host,
        error: "GitLab CLI (glab) 未安装",
      };
    }
    return {
      installed: true,
      loggedIn: false,
      host,
      error: stderr.trim() || `GitLab CLI (${host}) 未登录`,
    };
  }
}

async function isGitRepoLocally(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(targetPath, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

interface RawGhRepo {
  fullName?: string;
  nameWithOwner?: string;
  name?: string;
  description?: string;
  url?: string;
  sshUrl?: string;
  isPrivate?: boolean;
  defaultBranchRef?: { name?: string };
}

export async function fetchGitHubRepos(
  query: string | undefined,
  cloneBaseDir: string,
): Promise<RepoItem[]> {
  try {
    let stdout = "";
    if (query && query.trim()) {
      const res = await exec("gh", [
        "search",
        "repos",
        query.trim(),
        "--limit",
        "30",
        "--json",
        "fullName,name,description,url,sshUrl,isPrivate,defaultBranchRef",
      ]);
      stdout = res.stdout;
    } else {
      const res = await exec("gh", [
        "repo",
        "list",
        "--limit",
        "30",
        "--json",
        "nameWithOwner,name,description,url,sshUrl,isPrivate,defaultBranchRef",
      ]);
      stdout = res.stdout;
    }

    const items = JSON.parse(stdout || "[]") as RawGhRepo[];
    const results: RepoItem[] = [];

    for (const item of items) {
      const fullName = item.fullName || item.nameWithOwner;
      if (!fullName) continue;
      const localPath = path.join(cloneBaseDir, "github.com", fullName);
      const isLocal = await isGitRepoLocally(localPath);

      results.push({
        id: `github:${fullName}`,
        name: item.name || fullName.split("/")[1] || fullName,
        fullName,
        description: item.description || "",
        url: item.url || `https://github.com/${fullName}`,
        sshUrl: item.sshUrl || `git@github.com:${fullName}.git`,
        httpUrl: item.url ? `${item.url}.git` : `https://github.com/${fullName}.git`,
        defaultBranch: item.defaultBranchRef?.name || "main",
        provider: "github",
        isPrivate: Boolean(item.isPrivate),
        isLocal,
        localPath,
      });
    }

    return results;
  } catch (err: unknown) {
    console.error("fetchGitHubRepos error:", err);
    return [];
  }
}

interface RawGitLabRepo {
  name?: string;
  path_with_namespace?: string;
  description?: string;
  web_url?: string;
  ssh_url_to_repo?: string;
  http_url_to_repo?: string;
  default_branch?: string;
  visibility?: string;
}

export async function fetchGitLabRepos(
  query: string | undefined,
  gitlabUrl: string | undefined,
  cloneBaseDir: string,
): Promise<RepoItem[]> {
  const host = parseGitLabHost(gitlabUrl);
  try {
    const apiPath =
      query && query.trim()
        ? `projects?search=${encodeURIComponent(query.trim())}&membership=true&per_page=30`
        : `projects?membership=true&order_by=last_activity_at&per_page=30`;

    const { stdout } = await exec("glab", [
      "api",
      apiPath,
      "--hostname",
      host,
    ]);

    const items = JSON.parse(stdout || "[]") as RawGitLabRepo[];
    if (!Array.isArray(items)) return [];

    const results: RepoItem[] = [];

    for (const item of items) {
      const fullName = item.path_with_namespace;
      if (!fullName) continue;
      const localPath = path.join(cloneBaseDir, host, fullName);
      const isLocal = await isGitRepoLocally(localPath);

      results.push({
        id: `gitlab:${host}:${fullName}`,
        name: item.name || fullName.split("/").pop() || fullName,
        fullName,
        description: item.description || "",
        url: item.web_url || `https://${host}/${fullName}`,
        sshUrl: item.ssh_url_to_repo || `git@${host}:${fullName}.git`,
        httpUrl: item.http_url_to_repo || `https://${host}/${fullName}.git`,
        defaultBranch: item.default_branch || "main",
        provider: "gitlab",
        isPrivate: item.visibility === "private" || item.visibility === "internal",
        isLocal,
        localPath,
      });
    }

    return results;
  } catch (err: unknown) {
    console.error("fetchGitLabRepos error:", err);
    return [];
  }
}

export async function cloneAndCreateWorkspace(
  params: {
    provider: "github" | "gitlab";
    repoFullName: string;
    cloneUrl: string;
    branch?: string;
    isolation: "worktree" | "local";
    gitlabUrl?: string;
    cloneDir?: string;
  },
  paseo: PluginHandlerContext["paseo"],
): Promise<{ workspaceId: string; title: string; localPath: string }> {
  const cloneBaseDir = resolveCloneDir(params.cloneDir);
  const host = params.provider === "github" ? "github.com" : parseGitLabHost(params.gitlabUrl);
  const targetPath = path.join(cloneBaseDir, host, params.repoFullName);

  const isLocal = await isGitRepoLocally(targetPath);

  // 1. 如果本地尚未克隆，先执行完整 clone 以确保 .git 和 HEAD 结构完整
  if (!isLocal) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    console.log(`[git-workspace] Cloning ${params.cloneUrl} into ${targetPath}...`);
    await exec("git", ["clone", params.cloneUrl, targetPath]);
    console.log(`[git-workspace] Clone completed for ${params.repoFullName}`);
  }

  // 2. 本地已完整存在，安全创建 Paseo 工作区
  const workspace = await paseo.workspaces.create({
    title: params.repoFullName,
    source:
      params.isolation === "worktree"
        ? {
            kind: "worktree",
            cwd: targetPath,
            action: "checkout",
            refName: params.branch || undefined,
          }
        : {
            kind: "directory",
            path: targetPath,
          },
  });

  return {
    workspaceId: workspace.id,
    title: params.repoFullName,
    localPath: targetPath,
  };
}

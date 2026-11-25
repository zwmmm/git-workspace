import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { RepoItem, AuthStatus } from "../shared/contracts";
import {
  fetchGitHubRepos,
  fetchGitLabRepos,
  checkGitHubAuth,
  checkGitLabAuth,
  parseGitLabHost,
  resolveCloneDir,
} from "./git-service";

interface CacheData {
  lastSyncedAt: number;
  syncedAt?: { github?: number; gitlab?: Record<string, number> };
  github: RepoItem[];
  gitlab: Record<string, RepoItem[]>; // host -> repos
  auth: {
    github?: AuthStatus;
    gitlab?: Record<string, AuthStatus>;
  };
}

interface SyncConfig { gitlabUrl?: string; cloneDir?: string }
interface SyncResult { lastSyncedAt: number; auth: { github: AuthStatus; gitlab: AuthStatus }; errors: string[] }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

const CACHE_FILE = path.join(os.homedir(), ".paseo", "git-workspace-cache.json");

class RepoCacheService {
  private cache: CacheData = {
    lastSyncedAt: 0,
    github: [],
    gitlab: {},
    auth: {},
  };
  private isSyncing = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSync: Promise<SyncResult> | null = null;
  private errors: Record<string, string> = {};
  private readConfig: () => Promise<SyncConfig> = async () => ({});

  async init(readConfig?: () => Promise<SyncConfig>) {
    if (readConfig) this.readConfig = readConfig;
    if (this.initialized) return;
    this.initialized = true;

    // Load from disk
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(data) as CacheData;
      if (parsed && typeof parsed.lastSyncedAt === "number") {
        this.cache = parsed;
      }
    } catch {
      // Ignore missing cache file
    }

    const syncCurrent = async () => {
      try {
        const config = await this.readConfig();
        await this.syncAll(config.gitlabUrl, config.cloneDir);
      } catch (error) {
        console.error("[git-workspace] Background sync:", error instanceof Error ? error.message : String(error));
      }
    };
    this.initialTimer = setTimeout(() => { void syncCurrent(); }, 500);
    this.syncTimer = setInterval(() => { void syncCurrent(); }, 3 * 60 * 1000);
  }

  destroy() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.initialTimer = null;
    this.syncTimer = null;
    this.initialized = false;
  }

  async getAuth(gitlabUrl?: string, forceRefresh = false): Promise<{ github: AuthStatus; gitlab: AuthStatus }> {
    const host = parseGitLabHost(gitlabUrl);
    const cachedGh = this.cache.auth?.github;
    const cachedGl = this.cache.auth?.gitlab?.[host];

    if (!forceRefresh && cachedGh && cachedGl) {
      return { github: cachedGh, gitlab: cachedGl };
    }

    const [gh, gl] = await Promise.all([
      checkGitHubAuth(),
      checkGitLabAuth(gitlabUrl),
    ]);

    if (!this.cache.auth) this.cache.auth = {};
    if (!this.cache.auth.gitlab) this.cache.auth.gitlab = {};
    this.cache.auth.github = gh;
    this.cache.auth.gitlab[host] = gl;

    void this.persist();
    return { github: gh, gitlab: gl };
  }

  async syncAll(gitlabUrl?: string, cloneDir?: string): Promise<SyncResult> {
    if (this.activeSync) {
      await this.activeSync;
      // A different GitLab instance or clone root must get its own synchronization.
      if (this.syncKey !== `${parseGitLabHost(gitlabUrl)}:${resolveCloneDir(cloneDir)}`) {
        return this.syncAll(gitlabUrl, cloneDir);
      }
      return this.lastResult!;
    }
    this.syncKey = `${parseGitLabHost(gitlabUrl)}:${resolveCloneDir(cloneDir)}`;
    this.isSyncing = true;
    this.activeSync = this.performSync(gitlabUrl, cloneDir);
    try {
      this.lastResult = await this.activeSync;
      return this.lastResult;
    } finally {
      this.activeSync = null;
      this.isSyncing = false;
    }
  }

  private syncKey = "";
  private lastResult: SyncResult | null = null;

  private async performSync(gitlabUrl?: string, cloneDir?: string): Promise<SyncResult> {
    const baseDir = resolveCloneDir(cloneDir);
    const host = parseGitLabHost(gitlabUrl);
    const [ghAuth, glAuth, ghRepos, glRepos] = await Promise.allSettled([
      checkGitHubAuth(), checkGitLabAuth(gitlabUrl),
      fetchGitHubRepos(undefined, baseDir), fetchGitLabRepos(undefined, gitlabUrl, baseDir),
    ]);
    if (!this.cache.auth) this.cache.auth = {};
    if (!this.cache.auth.gitlab) this.cache.auth.gitlab = {};
    if (ghAuth.status === "fulfilled") this.cache.auth.github = ghAuth.value;
    if (glAuth.status === "fulfilled") this.cache.auth.gitlab[host] = glAuth.value;
    if (!this.cache.syncedAt) this.cache.syncedAt = {};
    if (!this.cache.syncedAt.gitlab) this.cache.syncedAt.gitlab = {};
    const now = Date.now();
    if (ghRepos.status === "fulfilled") {
      this.cache.github = ghRepos.value;
      this.cache.syncedAt.github = now;
      delete this.errors.github;
    } else {
      this.errors.github = `GitHub: ${errorMessage(ghRepos.reason)}`;
    }
    if (glRepos.status === "fulfilled") {
      this.cache.gitlab[host] = glRepos.value;
      this.cache.syncedAt.gitlab[host] = now;
      delete this.errors[host];
    } else {
      this.errors[host] = `GitLab (${host}): ${errorMessage(glRepos.reason)}`;
    }
    if (ghRepos.status === "fulfilled" || glRepos.status === "fulfilled") this.cache.lastSyncedAt = now;
    await this.persist();
    return {
      lastSyncedAt: this.cache.lastSyncedAt,
      auth: {
        github: this.cache.auth.github || { installed: true, loggedIn: false, checking: true },
        gitlab: this.cache.auth.gitlab[host] || { installed: true, loggedIn: false, checking: true },
      },
      errors: this.sourceErrors("all", host),
    };
  }

  private sourceErrors(provider: string, host: string): string[] {
    return [provider !== "gitlab" ? this.errors.github : undefined, provider !== "github" ? this.errors[host] : undefined]
      .filter((error): error is string => Boolean(error));
  }

  private async persist() {
    try {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
    } catch (err: unknown) {
      console.error("[git-workspace] Persist error:", err);
    }
  }

  async getRepos(params: {
    provider?: "all" | "github" | "gitlab";
    query?: string;
    gitlabUrl?: string;
    cloneDir?: string;
    forceRefresh?: boolean;
  }): Promise<{
    repos: RepoItem[];
    lastSyncedAt: number;
    isSyncing: boolean;
    auth: { github: AuthStatus; gitlab: AuthStatus };
    errors: string[];
    syncedAt: { github?: number; gitlab?: number };
  }> {
    const baseDir = resolveCloneDir(params.cloneDir);
    const host = parseGitLabHost(params.gitlabUrl);

    if (params.forceRefresh || this.cache.lastSyncedAt === 0) {
      void this.syncAll(params.gitlabUrl, params.cloneDir);
    }

    let all: RepoItem[] = [];

    if (!params.provider || params.provider === "all" || params.provider === "github") {
      all.push(...this.cache.github);
    }

    if (!params.provider || params.provider === "all" || params.provider === "gitlab") {
      const glList = this.cache.gitlab[host] || [];
      all.push(...glList);
    }

    const updated = await Promise.all(
      all.map(async (item) => {
        const itemHost = item.provider === "github" ? "github.com" : host;
        const localPath = path.join(baseDir, itemHost, item.fullName);
        let isLocal = false;
        try {
          const stat = await fs.stat(path.join(localPath, ".git"));
          isLocal = stat.isDirectory() || stat.isFile();
        } catch {
          isLocal = false;
        }
        return { ...item, isLocal, localPath };
      }),
    );

    let filtered = updated;
    if (params.query && params.query.trim()) {
      const q = params.query.trim().toLowerCase();
      filtered = updated.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }

    const auth = {
      github: this.cache.auth?.github || { installed: true, loggedIn: false, checking: true },
      gitlab: this.cache.auth?.gitlab?.[host] || { installed: true, loggedIn: false, checking: true },
    };

    return {
      repos: filtered,
      lastSyncedAt: params.provider === "github" ? (this.cache.syncedAt?.github || 0)
        : params.provider === "gitlab" ? (this.cache.syncedAt?.gitlab?.[host] || 0) : this.cache.lastSyncedAt,
      syncedAt: { github: this.cache.syncedAt?.github, gitlab: this.cache.syncedAt?.gitlab?.[host] },
      errors: this.sourceErrors(params.provider || "all", host),
      isSyncing: this.isSyncing,
      auth,
    };
  }
}

export const repoCacheService = new RepoCacheService();

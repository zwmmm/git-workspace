import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gitWorkspaceSettings } from "./shared/settings";
import {
  CheckAuthRpc,
  ListReposRpc,
  ListGitLabGroupsRpc,
  TriggerSyncRpc,
  CreateWorkspaceRpc,
  CreateRepositoryRpc,
  BrowseFoldersRpc,
  ImportFolderRpc,
} from "./shared/contracts";
import { readOperation, runOperation } from "./server/operations";
import { DeleteProjectRpc, GetProjectDeletionResultRpc, GetProjectHostRpc, InspectProjectDeletionRpc, type ProjectDeletionResultSchema } from "./shared/projects";
import { deleteProject, getProjectHost, inspectProjectDeletion } from "./server/project-service";
import {
  cloneAndCreateWorkspace,
  parseGitLabHost,
  resolveCloneDir,
} from "./server/git-service";
import { repoCacheService } from "./server/cache-service";
import {
  createRepository,
  listGitLabGroups,
  browseFolders,
  importFolder,
} from "./server/repository-service";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(gitWorkspaceSettings);
  const readSettings = async () => {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(state.error);
    return state.values;
  };
  const ready = repoCacheService.init(readSettings);
  server.handle(CheckAuthRpc, async ({ forceRefresh }) => {
    await ready;
    const config = await readSettings();
    return repoCacheService.getAuth(config.gitlabUrl, forceRefresh);
  });
  server.handle(ListReposRpc, async (input) => {
    await ready;
    return repoCacheService.getRepos({ ...input, ...(await readSettings()) });
  });
  server.handle(TriggerSyncRpc, async () => {
    await ready;
    const config = await readSettings();
    const result = await repoCacheService.syncAll(
      config.gitlabUrl,
      config.cloneDir
    );
    const { repos } = await repoCacheService.getRepos({
      ...config,
      provider: "all",
    });
    return {
      ...result,
      success: result.errors.length === 0,
      count: repos.length,
    };
  });
  const ensureTarget = (
    input: {
      provider: "github" | "gitlab";
      gitlabUrl?: string;
      cloneDir?: string;
    },
    config: Awaited<ReturnType<typeof readSettings>>
  ) => {
    if (
      (input.provider === "gitlab" &&
        (!input.gitlabUrl ||
          parseGitLabHost(input.gitlabUrl) !==
            parseGitLabHost(config.gitlabUrl))) ||
      (input.cloneDir &&
        resolveCloneDir(input.cloneDir) !== resolveCloneDir(config.cloneDir))
    )
      throw new Error("仓库设置已变化，请刷新后重试");
  };
  server.handle(ListGitLabGroupsRpc, async ({ gitlabUrl }) => {
    const config = await readSettings();
    ensureTarget({ provider: "gitlab", gitlabUrl }, config);
    return { groups: await listGitLabGroups(config) };
  });
  server.handle(CreateWorkspaceRpc, async (input, { paseo }) => {
    const config = await readSettings();
    ensureTarget(input, config);
    return runOperation(
      `workspace:${input.operationId}`,
      { input, config },
      () =>
        cloneAndCreateWorkspace(
          { ...input, gitlabUrl: config.gitlabUrl, cloneDir: config.cloneDir },
          paseo
        )
    );
  });
  server.handle(CreateRepositoryRpc, async (input) => {
    await ready;
    const config = await readSettings();
    ensureTarget(input, config);
    return runOperation(
      `repository:${input.operationId}`,
      { input, config },
      async () => {
        const result = await createRepository(input, config);
        if (!result.uncertain)
          await repoCacheService.rememberCreated(result.repo, config.gitlabUrl);
        return result;
      }
    );
  });
  server.handle(BrowseFoldersRpc, async ({ path }) =>
    browseFolders(path || (await readSettings()).cloneDir)
  );
  server.handle(ImportFolderRpc, ({ path, operationId }, { paseo }) =>
    runOperation(`import:${operationId}`, { path }, () =>
      importFolder(path, paseo, operationId)
    )
  );
  server.handle(GetProjectHostRpc, getProjectHost);
  server.handle(InspectProjectDeletionRpc, (input, { paseo }) =>
    inspectProjectDeletion(paseo, input)
  );
  server.handle(DeleteProjectRpc, (input, { paseo }) =>
    runOperation(`project:${input.hostId}:${input.operationId}`, input, () => deleteProject(paseo, input))
  );
  server.handle(GetProjectDeletionResultRpc, (input) =>
    readOperation<import("zod").infer<typeof ProjectDeletionResultSchema>>(`project:${input.hostId}:${input.operationId}`)
  );
  return () => {
    repoCacheService.destroy();
  };
}

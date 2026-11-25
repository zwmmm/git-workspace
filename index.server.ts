import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gitWorkspaceSettings } from "./shared/settings";
import { CheckAuthRpc, ListReposRpc, TriggerSyncRpc, CreateWorkspaceRpc, CreateRepositoryRpc, BrowseFoldersRpc, ImportFolderRpc } from "./shared/contracts";
import { cloneAndCreateWorkspace } from "./server/git-service";
import { repoCacheService } from "./server/cache-service";
import { createRepository, browseFolders, importFolder } from "./server/repository-service";

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
    return repoCacheService.getRepos({ ...input, ...await readSettings() });
  });
  server.handle(TriggerSyncRpc, async () => {
    await ready;
    const config = await readSettings();
    const result = await repoCacheService.syncAll(config.gitlabUrl, config.cloneDir);
    const { repos } = await repoCacheService.getRepos({ ...config, provider: "all" });
    return { ...result, success: result.errors.length === 0, count: repos.length };
  });
  server.handle(CreateWorkspaceRpc, async (input, { paseo }) => {
    const config = await readSettings();
    return cloneAndCreateWorkspace({ ...input, gitlabUrl: config.gitlabUrl, cloneDir: config.cloneDir }, paseo);
  });
  server.handle(CreateRepositoryRpc, async (input) => {
    const config = await readSettings();
    const result = await createRepository(input, config);
    void repoCacheService.syncAll(config.gitlabUrl, config.cloneDir).catch(console.error);
    return result;
  });
  server.handle(BrowseFoldersRpc, async ({ path }) => browseFolders(path || (await readSettings()).cloneDir));
  server.handle(ImportFolderRpc, ({ path }, { paseo }) => importFolder(path, paseo));
  return () => { repoCacheService.destroy(); };
}

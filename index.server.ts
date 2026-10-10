import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gitWorkspaceSettings } from "./shared/settings";
import {
  CheckAuthRpc,
  ListReposRpc,
  TriggerSyncRpc,
  CreateWorkspaceRpc,
} from "./shared/contracts";
import { cloneAndCreateWorkspace } from "./server/git-service";
import { repoCacheService } from "./server/cache-service";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(gitWorkspaceSettings);

  // Initialize cache and start periodic sync
  void repoCacheService.init();

  server.handle(CheckAuthRpc, async (input) => {
    return await repoCacheService.getAuth(input.gitlabUrl, input.forceRefresh);
  });

  server.handle(ListReposRpc, async (input) => {
    const { repos, lastSyncedAt, isSyncing, auth } = await repoCacheService.getRepos({
      provider: input.provider,
      query: input.query,
      gitlabUrl: input.gitlabUrl,
      cloneDir: input.cloneDir,
      forceRefresh: input.forceRefresh,
    });

    return {
      repos,
      lastSyncedAt,
      isSyncing,
      auth,
    };
  });

  server.handle(TriggerSyncRpc, async (input) => {
    const { lastSyncedAt, auth } = await repoCacheService.syncAll(input.gitlabUrl, input.cloneDir);
    const { repos } = await repoCacheService.getRepos({
      gitlabUrl: input.gitlabUrl,
      cloneDir: input.cloneDir,
    });
    return {
      success: true,
      lastSyncedAt,
      count: repos.length,
      auth,
    };
  });

  server.handle(CreateWorkspaceRpc, async (input, { paseo }) => {
    return await cloneAndCreateWorkspace(input, paseo);
  });

  return () => {
    repoCacheService.destroy();
  };
}

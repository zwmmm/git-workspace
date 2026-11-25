import type { PaseoApi } from "@getpaseo/client";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ProjectItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  workspaceCount: z.number(),
  agentCount: z.number(),
  blocked: z.enum(["running", "terminal", "archiving"]).nullable(),
  snapshot: z.string(),
});
export type ProjectItem = z.infer<typeof ProjectItemSchema>;

async function readPages<T>(load: (cursor?: string) => Promise<{
  entries: T[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}>): Promise<T[]> {
  const entries: T[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await load(cursor);
    entries.push(...result.entries);
    if (!result.pageInfo.hasMore) return entries;
    const next = result.pageInfo.nextCursor;
    if (!next || seen.has(next)) throw new Error("项目状态分页不完整，请刷新后重试");
    seen.add(next);
    cursor = next;
  } while (true);
}

export async function readProjectState(paseo: PaseoApi): Promise<ProjectItem[]> {
  const [directory, workspaces, agents, terminals] = await Promise.all([
    paseo.projects.list(),
    readPages(cursor => paseo.workspaces.list({ includeBackground: true,
      filter: { includeBackground: true, includeInternal: true }, page: { limit: 200, cursor } })),
    readPages(cursor => paseo.agents.list({ includeBackground: true,
      filter: { includeBackground: true, includeInternal: true, includeArchived: true }, page: { limit: 200, cursor } })),
    paseo.terminals.list(),
  ]);
  return directory.projects.map<ProjectItem>(project => {
    const owned = workspaces.filter(w => w.projectId === project.projectId);
    const ids = new Set(owned.map(w => w.id));
    const sessions = agents.filter(entry => entry.project?.projectKey === project.projectId ||
      (entry.agent.workspaceId && ids.has(entry.agent.workspaceId)));
    const running = owned.some(w => w.status === "running" || w.setupStatus === "running" ||
      w.scripts.some(s => s.lifecycle === "running")) ||
      sessions.some(({ agent }) => !agent.archivedAt && (agent.status === "running" || agent.status === "initializing" ||
        (agent.backgroundWork?.runningCount ?? agent.backgroundWork?.count ?? 0) > 0));
    const blocked = running ? "running" : owned.some(w => w.archivingAt) ? "archiving" :
      terminals.entries.some(t => ids.has(t.workspaceId)) ? "terminal" : null;
    const name = project.projectCustomName ?? project.projectDisplayName;
    return {
      id: project.projectId, name, path: project.projectRootPath,
      workspaceCount: owned.length, agentCount: sessions.length, blocked,
      snapshot: JSON.stringify({ name, path: project.projectRootPath,
        workspaces: owned.map(w => [w.id, w.workspaceDirectory ?? project.projectRootPath]).sort(),
        agents: sessions.map(({ agent }) => agent.id).sort() }),
    };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
}

export const InspectProjectDeletionRpc = defineRpc({
  name: "projects.inspect-deletion",
  input: z.object({ hostId: z.string(), projectIds: z.array(z.string()) }),
  output: z.object({ projects: z.array(ProjectItemSchema) }),
});
export const ProjectDeletionResultSchema = z.object({
  status: z.enum(["removed", "skipped", "failed", "unknown", "partial"]), message: z.string().optional(),
});
export const GetProjectDeletionResultRpc = defineRpc({
  name: "projects.deletion-result",
  input: z.object({ hostId: z.string(), operationId: z.string() }),
  output: ProjectDeletionResultSchema.nullable(),
});
export const DeleteProjectRpc = defineRpc({
  name: "projects.delete",
  input: z.object({ hostId: z.string(), projectId: z.string().min(1),
    snapshot: z.string(), operationId: z.string().min(1) }),
  output: ProjectDeletionResultSchema,
});

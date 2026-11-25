import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import { z } from "zod";
import { readProjectState, type ProjectItem } from "../shared/projects";

const exec = promisify(execFile);
type RunCli = (args: string[]) => Promise<{ stdout: string }>;
const runCli: RunCli = args => exec(process.env.PASEO_CLI || "paseo", args, {
  timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
});
const daemonSchema = z.object({ serverId: z.string(), home: z.string().min(1),
  daemonVersion: z.string(), connectedDaemon: z.literal("reachable") });
const unconfirmed = new Set<string>();
const projectKey = (hostId: string, projectId: string) => JSON.stringify([hostId, projectId]);
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readDaemon(run: RunCli) {
  const { stdout } = await run(["daemon", "status", "--json"]);
  return daemonSchema.parse(JSON.parse(stdout));
}

export async function getProjectHost() {
  return { hostId: (await readDaemon(runCli)).serverId };
}

async function verifyDaemon(hostId: string, run: RunCli) {
  const daemon = await readDaemon(run);
  if (daemon.serverId !== hostId) throw new Error("CLI 主机与当前主机不一致，未执行删除");
  const [major, minor, patch] = daemon.daemonVersion.split(/[.-]/).map(Number);
  if (!(major > 0 || minor > 17 || (minor === 17 && patch >= 4)))
    throw new Error("项目移除需要 Paseo 0.17.4 或更新版本");
  return daemon;
}

export async function inspectProjectDeletion(
  paseo: PaseoApi, input: { hostId: string; projectIds: string[] }, run: RunCli = runCli,
): Promise<{ projects: ProjectItem[] }> {
  await verifyDaemon(input.hostId, run);
  await run(["project", "delete", "--help"]);
  if (!input.projectIds.length) return { projects: [] };
  const rows = await readProjectState(paseo);
  const projects = [...new Set(input.projectIds)].map(id => {
    const project = rows.find(p => p.id === id);
    if (!project) { unconfirmed.delete(projectKey(input.hostId, id)); throw new Error("项目列表已变化，请刷新后重试"); }
    if (unconfirmed.has(projectKey(input.hostId, id))) throw new Error(`${project.name} 的上次删除结果尚未核实，未重新提交删除`);
    if (project.blocked) throw new Error(`${project.name} 仍有运行任务、终端或归档操作，请处理后重试`);
    return project;
  });
  return { projects };
}

async function performDeleteProject(
  paseo: PaseoApi, input: { hostId: string; projectId: string; snapshot: string }, run: RunCli = runCli,
): Promise<{ status: "removed" | "skipped" | "failed" | "unknown" | "partial"; message?: string }> {
  let home: string, before: ProjectItem;
  const key = projectKey(input.hostId, input.projectId);
  try {
    home = (await verifyDaemon(input.hostId, run)).home;
    const project = (await readProjectState(paseo)).find(p => p.id === input.projectId);
    if (!project) { unconfirmed.delete(key); return { status: "removed" }; }
    if (unconfirmed.has(key)) return { status: "unknown", message: "上次删除结果尚未核实，未重新提交删除" };
    if (project.blocked) return { status: "skipped", message: "项目仍有运行任务、终端或归档操作" };
    if (project.snapshot !== input.snapshot) return { status: "skipped", message: "项目或关联工作区已变化，请重新确认" };
    before = project;
  } catch (error) {
    return { status: "skipped", message: describe(error) };
  }
  let errorText = "项目移除结果待核实，请刷新列表后检查";
  let rejected = false;
  unconfirmed.add(key);
  try {
    await run(["project", "delete", input.projectId, "--home", home, "--json"]);
  } catch (error) {
    errorText = describe(error);
    if (error && typeof error === "object") {
      for (const output of ["stdout", "stderr"] as const) {
        if (!(output in error)) continue;
        try {
          const parsed = JSON.parse(String((error as Record<string, unknown>)[output]));
          rejected ||= parsed.error?.code === "PROJECT_DELETE_FAILED";
        } catch { /* Non-JSON output cannot establish whether the request was accepted. */ }
      }
    }
  }
  try {
    const after = (await readProjectState(paseo)).find(p => p.id === input.projectId);
    if (!after) { unconfirmed.delete(key); return { status: "removed" }; }
    if (rejected) {
      unconfirmed.delete(key);
      if (after.snapshot !== before.snapshot) return { status: "partial", message: "部分工作区或会话已归档，项目仍存在，请检查后重新确认" };
      return { status: "failed", message: errorText };
    }
  } catch {
    // The command may have been accepted even when its reply or the follow-up read is lost.
  }
  return { status: "unknown", message: errorText };
}

const deleting = new Set<string>();
export async function deleteProject(
  paseo: PaseoApi, input: { hostId: string; projectId: string; snapshot: string }, run: RunCli = runCli,
) {
  const key = projectKey(input.hostId, input.projectId);
  if (deleting.has(key)) return { status: "skipped" as const, message: "该项目正在删除，请稍后刷新列表" };
  deleting.add(key);
  try { return await performDeleteProject(paseo, input, run); }
  finally { deleting.delete(key); }
}

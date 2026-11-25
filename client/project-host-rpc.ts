import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GetProjectHostRpc } from "../shared/projects";

type Rpc = PluginClientContext["rpc"];
type Installation = { rpc: Rpc; hostId?: Promise<string> };

// Paseo evaluates a separate bundle for each host in the same app runtime.
// Each installation contributes only its own daemon-bound RPC capability.
const key = Symbol.for("zwmmm.git-workspace.project-host-rpc");
const runtime = globalThis as typeof globalThis & { [key]?: Set<Installation> };
const installations = runtime[key] ??= new Set<Installation>();

export function registerProjectHostRpc(client: PluginClientContext) {
  const installation: Installation = { rpc: client.rpc.bind(client) };
  installations.add(installation);
  return () => { installations.delete(installation); };
}

export async function findProjectHostRpc(hostId: string): Promise<Rpc | null> {
  try {
    return await Promise.any([...installations].map(async installation => {
      installation.hostId ??= installation.rpc(GetProjectHostRpc, {}).then(result => result.hostId).catch(error => {
        installation.hostId = undefined;
        throw error;
      });
      if (await installation.hostId !== hostId || !installations.has(installation))
        throw new Error("Plugin installation does not match the requested host");
      const rpc: Rpc = async (contract, input) => {
        if (!installations.has(installation)) throw new Error("Git Workspace plugin connection has closed");
        return installation.rpc(contract, input);
      };
      return rpc;
    }));
  } catch {
    return null;
  }
}

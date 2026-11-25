import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
const state = vi.hoisted(() => ({ paseo: null as unknown, remotePaseo: null as unknown, inspect: vi.fn(), remove: vi.fn(), result: vi.fn(), toast: vi.fn() }));
vi.mock("react-native", () => ({ View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (x: unknown) => x }, Platform: { OS: "web" } }));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => state.paseo,
  getPaseoClient: (serverId: string) => {
    if (serverId !== "other") throw new Error("Unexpected host");
    return state.remotePaseo;
  },
  useHosts: () => [
    { serverId: "host", label: "Mac", status: "online" },
    { serverId: "other", label: "Mac mini", status: "online" },
    { serverId: "offline", label: "Dev", status: "offline" },
  ],
  useRpc: (c: { name: string }) => c.name === "projects.delete" ? state.remove : c.name === "projects.deletion-result" ? state.result : state.inspect,
  defineTranslations: (x: object) => ({ ...x, message: (key: string) => key }),
  useTranslation: (m: { resources: { "zh-CN": Record<string, string> } }) => ({ t: (key: string, values: Record<string, unknown> = {}) =>
    (m.resources["zh-CN"][key] || key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name])) }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ show: state.toast }), Icon: "Icon", TextInput: "TextInput", ScrollView: "ScrollView",
  Modal: Object.assign(({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null,
    { Content: ({ children }: { children: React.ReactNode }) => children }),
}));
import { ProjectsSurface } from "../client/projects-surface";
import contribute from "../index.client";
let renderer: ReactTestRenderer;
let descriptors: { projectId: string; projectDisplayName: string; projectRootPath: string; projectKind: string }[];
const props = { theme: { colors: { surface0: "#20201e", surface2: "#2d2c2a", foreground: "#eeece8", foregroundMuted: "#aaa7a1", border: "#303030", accent: "#df805d", statusDanger: "#e99b90" } }, host: { id: "host", label: "Mac" }, layout: { compact: false, platform: "web" } } as unknown as PluginSurfaceProps;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks();
  state.result.mockResolvedValue(null);
  descriptors = ["demo", "empty"].map((name, i) => ({ projectId: String(i), projectDisplayName: name, projectRootPath: `/Projects/${name}`, projectKind: "git" }));
  const pageInfo = { hasMore: false, nextCursor: null };
  state.paseo = { projects: { list: vi.fn(async () => ({ projects: descriptors })), subscribe: () => () => {} },
    workspaces: { list: vi.fn(async () => ({ entries: [], pageInfo })) },
    agents: { list: vi.fn(async () => ({ entries: [], pageInfo })) }, terminals: { list: vi.fn(async () => ({ entries: [] })) } };
  state.inspect.mockImplementation(async ({ hostId, projectIds }: { hostId: string; projectIds: string[] }) => {
    if (hostId !== "host") throw new Error("CLI host mismatch");
    return { projects: descriptors.filter(p => projectIds.includes(p.projectId)).map(p => ({ id: p.projectId, name: p.projectDisplayName, path: p.projectRootPath, workspaceCount: 0, agentCount: 0, blocked: null, snapshot: p.projectId })) };
  });
  state.remove.mockImplementation(async ({ projectId }: { projectId: string }) => { descriptors = descriptors.filter(p => p.projectId !== projectId); return { status: "removed" }; });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); });
async function mount() { await act(async () => { renderer = create(<ProjectsSurface {...props} />); }); }
function button(label: string) { return renderer.root.findAllByType("Pressable" as never).find(n => n.props.accessibilityLabel === label)!; }
async function press(label: string) { await act(async () => { const b = button(label); expect(b).toBeDefined(); expect(b.props.disabled).not.toBe(true); await b.props.onPress(); }); }
const text = () => JSON.stringify(renderer.toJSON());

test("a host capsule switches project reads and clears the previous host's selection", async () => {
  const local = state.paseo as { projects: { list: () => unknown } };
  state.remotePaseo = { ...local, projects: { ...local.projects, list: async () => ({
    projects: [{ projectId: "0", projectDisplayName: "remote", projectRootPath: "/Remote/remote", projectKind: "git" }],
  }) } };
  await mount();
  expect(button("Mac")?.props.accessibilityState.selected).toBe(true);
  await press("全选");
  await press("Mac mini");
  expect(button("Mac mini").props.accessibilityState.selected).toBe(true);
  expect(text()).toContain("/Remote/remote");
  expect(text()).not.toContain("/Projects/demo");
  expect(button("删除所选").props.disabled).toBe(true);
  await press("Dev · 主机已离线");
  expect(text()).not.toContain("/Remote/remote");
  expect(button("删除所选").props.disabled).toBe(true);
});

test("deleting a project on another host uses that host's plugin transport", async () => {
  state.remotePaseo = state.paseo;
  const rpc = vi.fn(async (contract: { name: string }, input: { hostId?: string; projectIds?: string[] }) => {
    if (contract.name === "projects.host") return { hostId: "other" };
    if (input.hostId !== "other") throw new Error("Wrong deletion target");
    if (contract.name === "projects.inspect-deletion") return state.inspect({ ...input, hostId: "host" });
    if (contract.name === "projects.delete") return { status: "removed" };
    throw new Error("Unexpected RPC");
  });
  const register = () => () => {};
  const dispose = contribute({ rpc, addScreen: register, addSidebarHeaderItem: register,
    addSettingsScreen: register, addCommandCenterItem: register, addSlashCommand: register } as never);
  try {
    await mount();
    await press("Mac mini");
    await press("选择项目 demo /Projects/demo");
    await press("删除所选");
    expect(text()).toContain("主机：Mac mini");
    await press("确认删除");
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ name: "projects.delete" }),
      expect.objectContaining({ hostId: "other", projectId: "0" }));
    expect(state.remove).not.toHaveBeenCalled();
  } finally { await dispose(); }
});

test("uses the current plugin connection when it verifies the selected host despite differing screen metadata", async () => {
  state.remotePaseo = state.paseo;
  state.inspect.mockImplementation(async ({ hostId, projectIds }: { hostId: string; projectIds: string[] }) => {
    if (hostId !== "other") throw new Error("CLI host mismatch");
    return { projects: projectIds.length ? [{
      id: "0", name: "demo", path: "/Projects/demo", workspaceCount: 0, agentCount: 0, blocked: null, snapshot: "0",
    }] : [] };
  });
  await mount();
  await press("Mac mini");
  expect(button("选择项目 demo /Projects/demo").props.disabled).toBe(false);
  await press("选择项目 demo /Projects/demo");
  await press("删除所选");
  await press("确认删除");
  expect(state.remove).toHaveBeenCalledWith(expect.objectContaining({ hostId: "other", projectId: "0" }));
});

test("projects including empty ones are selectable immediately without a manage mode", async () => {
  await mount();
  expect(text()).toContain("/Projects/empty");
  await press("选择项目 demo /Projects/demo");
  expect(button("删除所选").props.disabled).toBe(false);
  expect(state.remove).not.toHaveBeenCalled();
});

test("search clears selection and canceling confirmation performs no deletion", async () => {
  await mount(); await press("全选"); await press("删除所选"); await press("取消");
  expect(state.remove).not.toHaveBeenCalled();
  await act(async () => renderer.root.findByProps({ accessibilityLabel: "搜索项目名称或路径" }).props.onChangeText("empty"));
  expect(button("删除所选").props.disabled).toBe(true);
  expect(button("选择项目 demo /Projects/demo")).toBeUndefined();
});

test("batch deletion retains unknown results without replaying them", async () => {
  state.remove.mockImplementation(async ({ projectId }: { projectId: string }) => {
    if (projectId === "1") return { status: "unknown", message: "connection lost" };
    descriptors = descriptors.filter(p => p.projectId !== projectId); return { status: "removed" };
  });
  await mount(); await press("全选"); await press("删除所选"); await press("确认删除");
  expect(state.remove).toHaveBeenCalledTimes(2);
  expect(state.toast).toHaveBeenCalledWith("成功删除 1 个项目 · 待核实 1 个", { variant: "warning" });
  expect(button("选择项目 empty /Projects/empty").props.disabled).toBe(true);
});

test("changing host during a pending mutation stops all later project requests", async () => {
  let finish!: (value: { status: string }) => void;
  state.remove.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await press("全选"); await press("删除所选");
  await act(async () => { void button("确认删除").props.onPress(); });
  expect(state.remove).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(<ProjectsSurface {...props} host={{ id: "other", label: "Other" }} />));
  await act(async () => finish({ status: "removed" }));
  expect(state.remove).toHaveBeenCalledTimes(1);
});

test("stopping a batch lets the current request finish without starting the next project", async () => {
  let finish!: (value: { status: string }) => void;
  state.remove.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await press("全选"); await press("删除所选");
  await act(async () => { void button("确认删除").props.onPress(); });
  await press("停止后续删除");
  await act(async () => finish({ status: "removed" }));
  expect(state.remove).toHaveBeenCalledTimes(1);
});

test("a slow full listing is not superseded by polling before it can finish", async () => {
  vi.useFakeTimers();
  const list = (state.paseo as { projects: { list: ReturnType<typeof vi.fn> } }).projects.list;
  let finish!: (value: unknown) => void;
  list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => finish({ projects: descriptors }));
    expect(text()).toContain("/Projects/empty");
  } finally { vi.useRealTimers(); }
});

test("initial fetch errors do not claim that the host has no projects", async () => {
  (state.paseo as { projects: { list: ReturnType<typeof vi.fn> } }).projects.list.mockRejectedValue(new Error("offline"));
  await mount();
  expect(text()).toContain("offline");
  expect(text()).not.toContain("当前主机暂无项目");
});

test("unavailable delete capability remains visible after a successful list refresh", async () => {
  state.inspect.mockRejectedValue(new Error("CLI unavailable"));
  await mount();
  expect(button("删除所选").props.disabled).toBe(true);
  expect(text()).toContain("CLI unavailable");
  expect(text()).toContain("主机：Mac");
});

test("a lost RPC reply reads the original operation result without another deletion", async () => {
  state.remove.mockRejectedValue(new Error("reply lost"));
  state.result.mockResolvedValue({ status: "removed" });
  await mount(); await press("选择项目 demo /Projects/demo"); await press("删除所选"); await press("确认删除");
  expect(state.remove).toHaveBeenCalledTimes(1);
  expect(state.result).toHaveBeenCalledWith({ hostId: "host", operationId: state.remove.mock.calls[0][0].operationId });
});

test("refresh reconciles an unknown result by reading project absence without resubmitting", async () => {
  state.remove.mockResolvedValue({ status: "unknown", message: "reply lost" });
  await mount(); await press("选择项目 demo /Projects/demo"); await press("删除所选"); await press("确认删除");
  descriptors = descriptors.filter(p => p.projectId !== "0");
  await press("刷新");
  expect(state.remove).toHaveBeenCalledTimes(1);
  expect(button("选择项目 demo /Projects/demo")).toBeUndefined();
});

test("confirmation includes historical session counts even when the project has no active workspace", async () => {
  state.inspect.mockImplementation(async ({ projectIds }: { projectIds: string[] }) => ({ projects: projectIds.map(id => ({ id, name: "demo", path: "/Projects/demo", workspaceCount: 0, agentCount: 3, blocked: null, snapshot: id })) }));
  await mount(); await press("选择项目 demo /Projects/demo"); await press("删除所选");
  expect(text()).toContain("3 个会话");
});

test("batch completion sends a single success toast with the deleted count", async () => {
  await mount(); await press("全选"); await press("删除所选"); await press("确认删除");
  expect(state.toast).toHaveBeenCalledTimes(1);
  expect(state.toast).toHaveBeenCalledWith("成功删除 2 个项目", { variant: "success" });
});

test.each(["failed", "partial", "skipped"])("batch completion reports %s in its toast", async status => {
  state.remove.mockResolvedValue({ status });
  await mount(); await press("选择项目 demo /Projects/demo"); await press("删除所选"); await press("确认删除");
  expect(state.toast).toHaveBeenCalledWith(status === "skipped"
    ? "成功删除 0 个项目 · 已跳过 1 个" : "成功删除 0 个项目 · 失败/部分完成 1 个", { variant: "warning" });
});

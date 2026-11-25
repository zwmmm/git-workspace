import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({
  list: vi.fn(),
  sync: vi.fn(),
  create: vi.fn(),
  remote: vi.fn(),
  browse: vi.fn(),
  import: vi.fn(),
  auth: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  Switch: "Switch",
  StyleSheet: { create: (x: unknown) => x },
  Platform: { OS: "web" },
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (c: { name: string }) =>
    ({
      "git.list-repos": state.list,
      "git.trigger-sync": state.sync,
      "git.create-workspace": state.create,
      "git.create-repository": state.remote,
      "git.browse-folders": state.browse,
      "git.import-folder": state.import,
      "git.check-auth": state.auth,
    }[c.name]),
  useSettings: () => ({
    status: "ready",
    values: {
      gitlabUrl: "https://git.example.com",
      cloneDir: "~/Projects",
      cloneProtocol: "ssh",
      defaultIsolation: "worktree",
    },
  }),
  defineTranslations: (x: unknown) => x,
  useTranslation: (m: {
    resources: { en: Record<string, string>; "zh-CN": Record<string, string> };
  }) => ({
    locale: "zh-CN",
    t: (key: string) => m.resources["zh-CN"][key] || key,
  }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  Icon: "Icon",
  TextInput: "TextInput",
  ScrollView: "ScrollView",
  Modal: Object.assign(
    ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? children : null,
    { Content: ({ children }: { children: React.ReactNode }) => children }
  ),
  SettingsSelect: "SettingsSelect",
  useToast: () => ({ show: () => {}, error: () => {} }),
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  useToast: () => ({ show: () => {}, error: () => {} }),
}));
import { GitWorkspaceSurface } from "../client/git-workspace-surface";
const repo = {
  id: "github:alice/demo",
  name: "demo",
  fullName: "alice/demo",
  description: "Demo",
  url: "https://github.com/alice/demo",
  sshUrl: "git@github.com:alice/demo.git",
  httpUrl: "https://github.com/alice/demo.git",
  defaultBranch: "trunk",
  provider: "github",
  isLocal: false,
  localPath: "/Projects/github.com/alice/demo",
  isPrivate: true,
};
const auth = {
  github: { installed: true, loggedIn: true, user: "alice" },
  gitlab: { installed: true, loggedIn: true, user: "alice" },
};
let renderer: ReactTestRenderer;
const props = {
  theme: {
    colors: {
      surface0: "#18181b",
      surface1: "#1f1f22",
      surface2: "#27272a",
      foreground: "#fafafa",
      foregroundMuted: "#a1a1aa",
      border: "#27272a",
      accent: "#e4e4e7",
      accentForeground: "#18181b",
      statusSuccess: "#6cb17b",
      statusWarning: "#c09664",
      statusDanger: "#d8847b",
    },
  },
  host: { id: "local", label: "Local" },
  layout: { compact: false, platform: "web" as const },
  navigation: { openWorkspace: state.navigate, openAgent: () => {} },
};
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockResolvedValue({ repos: [repo], auth, isSyncing: false });
  state.auth.mockResolvedValue(auth);
  state.create.mockResolvedValue({
    workspaceId: "ws",
    title: "demo",
    localPath: repo.localPath,
  });
  state.remote.mockResolvedValue({ repo, uncertain: false });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
});
async function mount() {
  await act(async () => {
    renderer = create(<GitWorkspaceSurface {...props} />);
  });
}
function button(label: string) {
  return renderer.root
    .findAllByType("Pressable" as never)
    .find((n) => n.props.accessibilityLabel === label)!;
}
async function press(label: string) {
  await act(async () => {
    const target = button(label);
    expect(target, `button: ${label}`).toBeDefined();
    await target.props.onPress();
  });
}

test("quick create passes defaults and actual default branch then navigates to the workspace", async () => {
  await mount();
  await press("克隆并创建 alice/demo");
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      repoFullName: "alice/demo",
      cloneUrl: "git@github.com:alice/demo.git",
      branch: "trunk",
      isolation: "worktree",
    })
  );
  expect(state.navigate).toHaveBeenCalledWith({ workspaceId: "ws" });
});
test("new repository retries workspace creation without creating the remote a second time", async () => {
  state.create.mockRejectedValueOnce(new Error("clone offline"));
  await mount();
  await press("新建仓库");
  const input = renderer.root
    .findAllByType("TextInput" as never)
    .find((n) => n.props.accessibilityLabel === "仓库名称")!;
  await act(async () => input.props.onChangeText("demo"));
  await press("创建并打开");
  expect(state.remote).toHaveBeenCalledTimes(1);
  await press("重试克隆并打开");
  expect(state.remote).toHaveBeenCalledTimes(1);
  expect(state.create).toHaveBeenCalledTimes(2);
});
test("pending creation blocks a second action even before the component rerenders", async () => {
  let finish!: (x: unknown) => void;
  state.create.mockReturnValue(
    new Promise((r) => {
      finish = r;
    })
  );
  await mount();
  const onPress = button("克隆并创建 alice/demo").props.onPress;
  await act(async () => {
    void onPress();
    void onPress();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () =>
    finish({ workspaceId: "ws", title: "demo", localPath: repo.localPath })
  );
});
test("an older search response cannot replace a newer query result", async () => {
  let older!: (x: unknown) => void;
  state.list
    .mockResolvedValueOnce({ repos: [repo], auth })
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          older = r;
        })
    )
    .mockResolvedValue({
      repos: [{ ...repo, id: "new", fullName: "alice/new" }],
      auth,
    });
  await mount();
  const search = renderer.root
    .findAllByType("TextInput" as never)
    .find((n) => n.props.accessibilityLabel === "搜索仓库")!;
  await act(async () => search.props.onChangeText("old"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 180));
  });
  await act(async () => search.props.onChangeText("new"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 180));
  });
  await act(async () => older({ repos: [repo], auth }));
  expect(button("克隆并创建 alice/new")).toBeDefined();
  expect(button("克隆并创建 alice/demo")).toBeUndefined();
});

test("a completed manual sync reloads the current provider rather than the previous one", async () => {
  let finish!: (x: unknown) => void;
  state.sync.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  state.list.mockImplementation(({ provider }: { provider: string }) =>
    Promise.resolve({
      repos: [
        provider === "gitlab"
          ? {
              ...repo,
              id: "gitlab:new",
              provider: "gitlab",
              fullName: "team/new",
            }
          : repo,
      ],
      auth,
    })
  );
  await mount();
  await act(async () => {
    void button("同步").props.onPress();
  });
  await press("GitLab");
  await act(async () => finish({}));
  expect(button("克隆并创建 team/new")).toBeDefined();
  expect(button("克隆并创建 alice/demo")).toBeUndefined();
});

test("new remote creation waits for the refreshed account instead of using cached login state", async () => {
  let finish!: (x: unknown) => void;
  state.auth.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await mount();
  await press("新建仓库");
  const input = renderer.root
    .findAllByType("TextInput" as never)
    .find((n) => n.props.accessibilityLabel === "仓库名称")!;
  await act(async () => input.props.onChangeText("demo"));
  expect(button("创建并打开").props.disabled).toBe(true);
  await act(async () => finish(auth));
  expect(button("创建并打开").props.disabled).toBe(false);
});

test("returning to a host cannot let an older creation unlock or navigate a newer operation", async () => {
  let oldFinish!: (x: unknown) => void, newFinish!: (x: unknown) => void;
  state.create
    .mockReturnValueOnce(
      new Promise((resolve) => {
        oldFinish = resolve;
      })
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        newFinish = resolve;
      })
    );
  await mount();
  await act(async () => {
    void button("克隆并创建 alice/demo").props.onPress();
  });
  await act(async () =>
    renderer.update(
      <GitWorkspaceSurface {...props} host={{ id: "other", label: "Other" }} />
    )
  );
  await act(async () => renderer.update(<GitWorkspaceSurface {...props} />));
  await act(async () => {
    void button("克隆并创建 alice/demo").props.onPress();
  });
  await act(async () =>
    oldFinish({ workspaceId: "old", localPath: repo.localPath })
  );
  expect(state.navigate).not.toHaveBeenCalled();
  expect(button("克隆并创建 alice/demo").props.disabled).toBe(true);
  await act(async () =>
    newFinish({ workspaceId: "new", localPath: repo.localPath })
  );
  expect(state.navigate).toHaveBeenCalledWith({ workspaceId: "new" });
});

test("clicking the active provider does not invalidate the only pending load", async () => {
  let finish!: (x: unknown) => void;
  state.list.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await mount();
  await press("全部");
  await act(async () => finish({ repos: [repo], auth }));
  expect(button("克隆并创建 alice/demo")).toBeDefined();
});

test("an uncertain repository result permits changing the name and creating a different repository", async () => {
  state.remote.mockResolvedValue({ repo, uncertain: true });
  await mount();
  await press("新建仓库");
  let input = renderer.root
    .findAllByType("TextInput" as never)
    .find((n) => n.props.accessibilityLabel === "仓库名称")!;
  await act(async () => input.props.onChangeText("demo"));
  await press("创建并打开");
  input = renderer.root
    .findAllByType("TextInput" as never)
    .find((n) => n.props.accessibilityLabel === "仓库名称")!;
  expect(input.props.editable).toBe(true);
  await act(async () => input.props.onChangeText("another"));
  await press("创建并打开");
  expect(state.remote).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: "another" })
  );
});

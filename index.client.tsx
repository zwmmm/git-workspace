import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GitWorkspaceSurface } from "./client/git-workspace-surface";
import { GitWorkspaceSettings } from "./client/git-workspace-settings";

export default function contribute(client: PluginClientContext) {
  // 1. 注册主界面
  const removeSurface = client.addSurface("git-workspace", GitWorkspaceSurface);

  // 2. 注册侧边栏入口
  const removeSidebar = client.addSidebarItem({
    id: "git-workspace",
    title: "Git 仓库",
    icon: "FolderGit2",
    surface: "git-workspace",
  });

  // 3. 注册设置界面
  const removeSettings = client.addSettingsScreen({
    id: "git-workspace-settings",
    title: "Git 仓库与 GitLab 设置",
    icon: "FolderGit2",
    Component: GitWorkspaceSettings,
  });

  // 4. 注册 ⌘K 快捷启动项
  const removeCommand = client.addCommandCenterItem({
    id: "create-from-git",
    title: "从 GitHub / GitLab 克隆创建工作区",
    icon: "FolderGit2",
    context: "global",
    keywords: ["git", "github", "gitlab", "clone", "repo", "workspace", "项目", "克隆"],
    onSelect({ openSurface }) {
      openSurface("git-workspace");
    },
  });

  // 5. 注册斜杠指令 /git
  const removeSlash = client.addSlashCommand({
    name: "git",
    description: "从 GitHub / GitLab 搜索克隆并创建工作区",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openSurface }) {
      openSurface("git-workspace");
    },
  });

  return () => {
    removeSurface();
    removeSidebar();
    removeSettings();
    removeCommand();
    removeSlash();
  };
}

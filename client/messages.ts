import { defineTranslations } from "@getpaseo/plugin/client";

export const messages = defineTranslations({
  resources: {
    en: {
      repos: "Repos",
      settings: {
        title: "Repository settings",
        gitLabUrl: "GitLab URL",
        gitLabHint: "Use gitlab.com or your own GitLab host.",
        local: "Local repositories",
        cloneDir: "Local repository directory",
        cloneDirHint: "Root directory for cloned repositories.",
        cloneProtocol: "Clone protocol",
        workspaceType: "Workspace type",
        worktree: "Git worktree (recommended)",
        localDirectory: "Local directory",
        loading: "Loading…",
        saving: "Saving…",
        retry: "Retry",
        loadFailed: "Could not load the settings. Try again.",
        saveFailed: "Could not save the settings.",
      },
    },
    "zh-CN": {
      repos: "仓库",
      settings: {
        title: "仓库设置",
        gitLabUrl: "GitLab 地址",
        gitLabHint: "可填写 gitlab.com 或自建 GitLab 地址。",
        local: "本地仓库",
        cloneDir: "本地仓库目录",
        cloneDirHint: "克隆仓库的根目录。",
        cloneProtocol: "克隆协议",
        workspaceType: "工作区类型",
        worktree: "Git 工作树（推荐）",
        localDirectory: "本地目录",
        loading: "正在加载…",
        saving: "正在保存…",
        retry: "重试",
        loadFailed: "无法读取设置，请重试。",
        saveFailed: "无法保存设置。",
      },
    },
  },
});

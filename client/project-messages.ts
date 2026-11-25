import { defineTranslations } from "@getpaseo/plugin/client";

export const projectMessages = defineTranslations({ resources: {
  en: {
    projects: "Projects", refresh: "Refresh", selectAll: "Select all", clear: "Clear selection",
    search: "Search projects by name or path", selected: "{{count}} selected", total: "{{count}} projects",
    deleteSelected: "Delete selected", cancel: "Cancel", confirmDelete: "Delete",
    confirmTitle: "Delete {{count}} projects?", confirmImpact: "{{workspaces}} workspaces and {{agents}} sessions are associated with these projects; unarchived workspaces and sessions will be archived.",
    preserve: "Local code, worktree files and remote repositories are kept.",
    empty: "No projects on this host", noMatches: "No matching projects", workspaces: "{{count}} workspaces",
    selectProject: "Select project {{name}} {{path}}", running: "Stop running tasks first", terminal: "Close project terminals first",
    archiving: "Workspace archival in progress", inspect: "Checking…", deleting: "Deleting {{done}} / {{total}} · {{name}}",
    stop: "Stop remaining deletions", stopping: "Stopping after current project…", stopped: "Skipped after stopping",
    retry: "Retry", removed: "Deleted", skipped: "Skipped", unknown: "Result unconfirmed", partial: "Partly archived", failed: "Failed", offline: "Host offline",
    host: "Host: {{host}}", deletionSuccess: "Successfully deleted {{count}} projects", deletionSkipped: "Skipped {{count}}", deletionFailed: "Failed/partial {{count}}", deletionUnknown: "Unconfirmed {{count}}",
  },
  "zh-CN": {
    projects: "项目", refresh: "刷新", selectAll: "全选", clear: "取消选择",
    search: "搜索项目名称或路径", selected: "已选 {{count}} 个项目", total: "{{count}} 个项目",
    deleteSelected: "删除所选", cancel: "取消", confirmDelete: "确认删除",
    confirmTitle: "删除选中的 {{count}} 个项目？", confirmImpact: "关联 {{workspaces}} 个工作区、{{agents}} 个会话；未归档的工作区及会话将归档。",
    preserve: "本地代码、工作树文件和远程仓库保留。",
    empty: "当前主机暂无项目", noMatches: "没有匹配的项目", workspaces: "{{count}} 个工作区",
    selectProject: "选择项目 {{name}} {{path}}", running: "请先停止运行中的任务", terminal: "请先关闭项目终端",
    archiving: "工作区正在归档", inspect: "检查中…", deleting: "正在删除 {{done}} / {{total}} · {{name}}",
    stop: "停止后续删除", stopping: "当前项目完成后停止…", stopped: "已停止后续删除",
    retry: "重试", removed: "已删除", skipped: "已跳过", unknown: "结果待核实", partial: "部分已归档", failed: "删除失败", offline: "主机已离线",
    host: "主机：{{host}}", deletionSuccess: "成功删除 {{count}} 个项目", deletionSkipped: "已跳过 {{count}} 个", deletionFailed: "失败/部分完成 {{count}} 个", deletionUnknown: "待核实 {{count}} 个",
  },
} });

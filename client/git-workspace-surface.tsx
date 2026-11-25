import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import {
  useRpc,
  useSettings,
  useTranslation,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  ScrollView,
  SettingsSelect,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { gitWorkspaceSettings } from "../shared/settings";
import {
  BrowseFoldersRpc,
  CheckAuthRpc,
  CreateRepositoryRpc,
  CreateWorkspaceRpc,
  ImportFolderRpc,
  ListReposRpc,
  ListGitLabGroupsRpc,
  TriggerSyncRpc,
  type AuthStatus,
  type GitLabGroup,
  type RepoItem,
} from "../shared/contracts";
import { providerIcons } from "./provider-icons";
import { messages } from "./messages";

type Provider = "github" | "gitlab";
type Form =
  | { kind: "new" }
  | { kind: "import" }
  | { kind: "options"; repo: RepoItem };
type FolderList = {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
};
const newOperationId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function accountText(auth?: AuthStatus) {
  if (!auth || auth.checking) return "检查中";
  if (!auth.installed) return "CLI 未安装";
  if (auth.loggedIn) return auth.user ? `@${auth.user}` : "已连接";
  return auth.error && !/not logged|未登录|login|auth login/i.test(auth.error)
    ? "检查失败"
    : "未登录";
}

export function GitWorkspaceSurface({
  theme,
  host,
  layout,
  navigation,
}: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const settingsState = useSettings(gitWorkspaceSettings);
  const settings =
    settingsState.status === "ready" ? settingsState.values : null;
  const gitlabUrl = settings?.gitlabUrl || "https://gitlab.com";
  const cloneDir = settings?.cloneDir || "~/Projects";
  const protocol = settings?.cloneProtocol || "ssh";
  const isolation = settings?.defaultIsolation || "worktree";
  const listRepos = useRpc(ListReposRpc),
    sync = useRpc(TriggerSyncRpc),
    createWorkspace = useRpc(CreateWorkspaceRpc);
  const createRepository = useRpc(CreateRepositoryRpc),
    browseFolders = useRpc(BrowseFoldersRpc),
    importFolder = useRpc(ImportFolderRpc),
    checkAuth = useRpc(CheckAuthRpc);
  const listGitLabGroups = useRpc(ListGitLabGroupsRpc);
  const [groups, setGroups] = useState<GitLabGroup[]>([]);
  const [namespace, setNamespace] = useState("personal");
  const [groupsLoading, setGroupsLoading] = useState(false),
    [groupsError, setGroupsError] = useState("");
  const groupRequest = useRef(0);
  const [focusedInput, setFocusedInput] = useState<string>();
  const [width, setWidth] = useState(layout.compact ? 400 : 1000);
  const compact = width < 680;
  const [provider, setProvider] = useState<"all" | Provider>("all");
  const [localFilter, setLocalFilter] = useState<"all" | "local" | "remote">(
    "all"
  );
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [loading, setLoading] = useState(true),
    [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number>();
  const [auth, setAuth] = useState<{
    github?: AuthStatus;
    gitlab?: AuthStatus;
  }>({});
  const [formAuth, setFormAuth] = useState<{
    github?: AuthStatus;
    gitlab?: AuthStatus;
  }>({});
  const [authRefreshing, setAuthRefreshing] = useState(false);
  const authRequest = useRef(0),
    formOperation = useRef(""),
    quickOperations = useRef(new Map<string, string>());
  const [loadError, setLoadError] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string }>();
  const [form, setForm] = useState<Form | null>(null),
    [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [newProvider, setNewProvider] = useState<Provider>("github"),
    [name, setName] = useState("");
  const [isPublic, setPublic] = useState(false),
    [remoteRepo, setRemoteRepo] = useState<RepoItem>();
  const [uncertain, setUncertain] = useState(false);
  const [folderPath, setFolderPath] = useState(""),
    [folders, setFolders] = useState<FolderList | null>(null),
    [browsing, setBrowsing] = useState(false);
  const [optionIsolation, setOptionIsolation] = useState(isolation),
    [optionProtocol, setOptionProtocol] = useState(protocol);
  const lock = useRef(false),
    syncLock = useRef(false),
    request = useRef(0),
    folderRequest = useRef(0);
  const configKey = `${host.id}:${gitlabUrl}:${cloneDir}:${protocol}:${isolation}`;
  const revision = useRef({ key: configKey, value: 0 });
  if (revision.current.key !== configKey)
    revision.current = { key: configKey, value: revision.current.value + 1 };
  const context = `${configKey}#${revision.current.value}`;
  const currentContext = useRef(context),
    alive = useRef(true);
  currentContext.current = context;
  const isCurrent = (key: string) =>
    alive.current && currentContext.current === key;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
      folderRequest.current++;
    };
  }, []);
  useEffect(() => {
    lock.current = false;
    syncLock.current = false;
    request.current++;
    folderRequest.current++;
    authRequest.current++;
    quickOperations.current.clear();
    setFormAuth({});
    setFocusedInput(undefined);
    setAuthRefreshing(false);
    setForm(null);
    setBusy(null);
    setRepos([]);
    setAuth({});
    setLoadError("");
    setRowError(undefined);
    setSyncing(false);
  }, [context]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 150);
    return () => clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    if (!settings) return;
    const id = ++request.current,
      key = context;
    setLoading(true);
    try {
      const result = await listRepos({ provider, query, gitlabUrl, cloneDir });
      if (!isCurrent(key) || id !== request.current) return;
      setRepos(result.repos);
      setAuth(result.auth || {});
      setSyncedAt(result.lastSyncedAt);
      setSyncing(Boolean(result.isSyncing));
      setLoadError((result.errors || []).join("\n"));
    } catch (error) {
      if (isCurrent(key) && id === request.current)
        setLoadError(errorText(error));
    } finally {
      if (isCurrent(key) && id === request.current) setLoading(false);
    }
  }, [
    listRepos,
    provider,
    query,
    gitlabUrl,
    cloneDir,
    context,
    Boolean(settings),
  ]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(timer);
  }, [syncing, load]);

  const loadGroups = useCallback(async () => {
    const key = context,
      id = ++groupRequest.current;
    setGroupsLoading(true);
    setGroupsError("");
    try {
      const result = await listGitLabGroups({ gitlabUrl });
      if (isCurrent(key) && id === groupRequest.current)
        setGroups(result.groups);
    } catch (error) {
      if (isCurrent(key) && id === groupRequest.current)
        setGroupsError(errorText(error));
    } finally {
      if (isCurrent(key) && id === groupRequest.current)
        setGroupsLoading(false);
    }
  }, [context, gitlabUrl, listGitLabGroups]);
  useEffect(() => {
    setNamespace("personal");
    setGroups([]);
    setGroupsError("");
    if (form?.kind === "new" && newProvider === "gitlab") void loadGroups();
    else {
      groupRequest.current++;
      setGroupsLoading(false);
    }
    return () => {
      groupRequest.current++;
    };
  }, [form?.kind, newProvider, loadGroups]);

  const manualSync = async () => {
    if (syncLock.current || !settings) return;
    syncLock.current = true;
    setSyncing(true);
    const key = context;
    try {
      await sync({});
      if (isCurrent(key)) await latestLoad.current();
    } catch (error) {
      if (isCurrent(key)) setLoadError(errorText(error));
    } finally {
      if (isCurrent(key)) {
        syncLock.current = false;
        setSyncing(false);
      }
    }
  };
  const refreshFormAuth = () => {
    const key = context,
      id = ++authRequest.current;
    setAuthRefreshing(true);
    setFormAuth({});
    setFormError("");
    void checkAuth({ forceRefresh: true })
      .then((result) => {
        if (isCurrent(key) && id === authRequest.current) setFormAuth(result);
      })
      .catch((error) => {
        if (isCurrent(key) && id === authRequest.current)
          setFormError(errorText(error));
      })
      .finally(() => {
        if (isCurrent(key) && id === authRequest.current)
          setAuthRefreshing(false);
      });
  };
  const openForm = (next: Form) => {
    if (lock.current || !settings) return;
    formOperation.current = newOperationId();
    setFocusedInput(undefined);
    authRequest.current++;
    setForm(next);
    setFormError("");
    setName("");
    setPublic(false);
    setRemoteRepo(undefined);
    setUncertain(false);
    setFolderPath("");
    setFolders(null);
    folderRequest.current++;
    setBrowsing(false);
    setOptionIsolation(isolation);
    setOptionProtocol(protocol);
    setNewProvider(
      auth.github?.loggedIn
        ? "github"
        : auth.gitlab?.loggedIn
        ? "gitlab"
        : "github"
    );
    if (next.kind === "new") refreshFormAuth();
  };

  const createFromRepo = (
    repo: RepoItem,
    mode = isolation,
    cloneProtocol = protocol,
    operationId = quickOperations.current.get(repo.id) || newOperationId()
  ) =>
    createWorkspace({
      operationId,
      provider: repo.provider,
      repoFullName: repo.fullName,
      cloneUrl: cloneProtocol === "ssh" ? repo.sshUrl : repo.httpUrl,
      branch: repo.defaultBranch || undefined,
      isolation: mode,
      gitlabUrl,
      cloneDir,
    });
  const finish = (
    result: { workspaceId: string; localPath: string },
    repo?: RepoItem
  ) => {
    if (repo)
      setRepos((current) =>
        current.map((item) =>
          item.id === repo.id
            ? { ...item, isLocal: true, localPath: result.localPath }
            : item
        )
      );
    setForm(null);
    if (navigation?.openWorkspace)
      navigation.openWorkspace({ workspaceId: result.workspaceId });
    else
      toast.show("工作区已创建；更新 Paseo 客户端后可自动进入", {
        variant: "success",
      });
  };
  const quickCreate = async (repo: RepoItem) => {
    if (lock.current || !settings) return;
    lock.current = true;
    setBusy(repo.id);
    setRowError(undefined);
    if (!quickOperations.current.has(repo.id))
      quickOperations.current.set(repo.id, newOperationId());
    const key = context;
    try {
      const result = await createFromRepo(repo);
      if (isCurrent(key)) {
        quickOperations.current.delete(repo.id);
        finish(result, repo);
      }
    } catch (error) {
      if (isCurrent(key)) setRowError({ id: repo.id, text: errorText(error) });
    } finally {
      if (isCurrent(key)) {
        lock.current = false;
        setBusy(null);
      }
    }
  };
  const submitForm = async () => {
    if (lock.current || !form || !settings) return;
    if (
      form.kind === "new" &&
      !remoteRepo &&
      (authRefreshing ||
        !formAuth[newProvider]?.loggedIn ||
        !formAuth[newProvider]?.user)
    )
      return;
    const selectedGroup = groups.find(
      (group) => String(group.id) === namespace
    );
    if (
      form.kind === "new" &&
      newProvider === "gitlab" &&
      !remoteRepo &&
      (groupsLoading ||
        groupsError ||
        (namespace !== "personal" && !selectedGroup))
    )
      return;
    lock.current = true;
    setBusy(form.kind);
    setFormError("");
    const key = context;
    try {
      if (form.kind === "import") {
        const result = await importFolder({
          path: folderPath,
          operationId: `${formOperation.current}:import:${folderPath}`,
        });
        if (isCurrent(key)) finish(result);
      } else if (form.kind === "options") {
        const result = await createFromRepo(
          form.repo,
          optionIsolation,
          optionProtocol,
          `${formOperation.current}:${optionIsolation}:${optionProtocol}`
        );
        if (isCurrent(key)) finish(result, form.repo);
      } else {
        let repo = remoteRepo;
        if (!repo) {
          const result = await createRepository({
            operationId: `${formOperation.current}:remote`,
            expectedOwner: formAuth[newProvider]!.user!,
            ...(newProvider === "gitlab" && selectedGroup
              ? {
                  namespaceId: selectedGroup.id,
                  namespacePath: selectedGroup.fullPath,
                }
              : {}),
            gitlabUrl,
            cloneDir,
            provider: newProvider,
            name,
            isPublic,
          });
          if (!isCurrent(key)) return;
          repo = result.repo;
          setRemoteRepo(repo);
          if (!result.uncertain) {
            setProvider(repo.provider);
            setSearch("");
            setQuery("");
            setRepos((current) => [
              repo!,
              ...current.filter((item) => item.id !== repo!.id),
            ]);
          }
          setUncertain(result.uncertain);
          if (result.uncertain) {
            setFormError("已找到同名仓库，创建结果待确认。可使用该仓库继续。");
            return;
          }
        }
        const result = await createFromRepo(
          repo,
          isolation,
          protocol,
          `${formOperation.current}:workspace`
        );
        if (isCurrent(key)) {
          finish(result, repo);
          void latestLoad.current();
        }
      }
    } catch (error) {
      if (isCurrent(key)) setFormError(errorText(error));
    } finally {
      if (isCurrent(key)) {
        lock.current = false;
        setBusy(null);
      }
    }
  };
  const browse = async (path = folderPath || cloneDir) => {
    if (lock.current) return;
    const id = ++folderRequest.current,
      key = context;
    setBrowsing(true);
    setFormError("");
    try {
      const result = await browseFolders({ path });
      if (isCurrent(key) && id === folderRequest.current) setFolders(result);
    } catch (error) {
      if (isCurrent(key) && id === folderRequest.current)
        setFormError(errorText(error));
    } finally {
      if (isCurrent(key) && id === folderRequest.current) setBrowsing(false);
    }
  };
  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        header: {
          paddingHorizontal: compact ? 16 : 24,
          paddingVertical: 20,
          gap: 16,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        },
        heading: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        },
        title: {
          color: theme.colors.foreground,
          fontSize: 20,
          fontWeight: "500",
        },
        actions: {
          flexDirection: "row",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        },
        button: {
          minHeight: 32,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "transparent",
          backgroundColor: theme.colors.surface2,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        },
        buttonXs: { minHeight: 28 },
        buttonIcon: { width: 32, paddingHorizontal: 0 },
        buttonIconXs: { width: 28 },
        ghost: { backgroundColor: "transparent" },
        primary: {
          backgroundColor: theme.colors.accent,
          borderColor: theme.colors.accent,
        },
        buttonText: {
          color: theme.colors.foreground,
          fontSize: 14,
          fontWeight: "normal",
        },
        buttonTextXs: { fontSize: 12 },
        ghostText: { color: theme.colors.foregroundMuted },
        primaryText: { color: theme.colors.accentForeground },
        muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
        input: {
          flex: 1,
          minWidth: 0,
          minHeight: 32,
          paddingHorizontal: 12,
          paddingVertical: 5,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: "transparent",
          borderRadius: 6,
          fontSize: 14,
          lineHeight: 20,
          includeFontPadding: false,
          ...(Platform.OS === "web" ? { outlineWidth: 0 } : {}),
        },
        inputDisabled: { opacity: 0.5 },
        inputFocused: {
          borderColor: theme.colors.border,
          ...(Platform.OS === "web"
            ? {
                outlineColor: theme.colors.accent,
                outlineWidth: 2,
                outlineOffset: 1,
                outlineStyle: "solid" as const,
              }
            : {}),
        },
        search: { flexDirection: "row", alignItems: "center", gap: 8 },
        filters: {
          flexDirection: "row",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        },
        row: {
          flexDirection: "row",
          alignItems: "center",
          gap: compact ? 8 : 12,
          minHeight: 68,
          paddingHorizontal: compact ? 16 : 24,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderColor: theme.colors.border,
        },
        repoInfo: { flex: 1, minWidth: 0, gap: 4 },
        name: {
          color: theme.colors.foreground,
          fontSize: 14,
          fontWeight: "500",
          flexShrink: 1,
        },
        status: {
          color: theme.colors.foregroundMuted,
          fontSize: 11,
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: 4,
          backgroundColor: theme.colors.surface2,
        },
        local: {
          color: theme.colors.statusSuccess,
          backgroundColor: /^#[\da-f]{6}$/i.test(theme.colors.statusSuccess)
            ? `${theme.colors.statusSuccess}20`
            : theme.colors.surface2,
        },
        footer: {
          paddingHorizontal: compact ? 16 : 24,
          paddingVertical: 12,
          gap: 16,
          flexDirection: "row",
          flexWrap: "wrap",
          borderTopWidth: 1,
          borderColor: theme.colors.border,
        },
        error: {
          color: theme.colors.statusDanger,
          fontSize: 12,
          lineHeight: 18,
        },
        empty: { padding: 32, alignItems: "center", gap: 12 },
        field: { gap: 8 },
        label: { color: theme.colors.foregroundMuted, fontSize: 14 },
        form: { gap: 20 },
        separator: { height: 1, backgroundColor: theme.colors.border },
        folder: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 12,
          minHeight: 40,
        },
      }),
    [theme, compact]
  );
  const button = (
    label: string,
    onPress: () => unknown,
    options: {
      icon?: string;
      size?: "xs" | "sm";
      primary?: boolean;
      disabled?: boolean;
      accessibilityLabel?: string;
      ghost?: boolean;
    } = {}
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={options.accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(options.disabled) }}
      disabled={options.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        options.size === "xs" && styles.buttonXs,
        !label && styles.buttonIcon,
        !label && options.size === "xs" && styles.buttonIconXs,
        options.primary && styles.primary,
        options.ghost && styles.ghost,
        { opacity: options.disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {options.icon ? (
        <Icon
          name={options.icon}
          size={options.size === "xs" ? 12 : 14}
          color={
            options.primary
              ? theme.colors.accentForeground
              : options.ghost
              ? theme.colors.foregroundMuted
              : theme.colors.foreground
          }
        />
      ) : null}
      {label ? (
        <Text
          style={[
            styles.buttonText,
            options.size === "xs" && styles.buttonTextXs,
            options.ghost && styles.ghostText,
            options.primary && styles.primaryText,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
  const visible = repos.filter(
    (repo) =>
      localFilter === "all" ||
      (localFilter === "local" ? repo.isLocal : !repo.isLocal)
  );
  const formTitle =
    form?.kind === "new"
      ? "新建仓库"
      : form?.kind === "import"
      ? "导入本地文件夹"
      : "创建工作区";
  const newAuth = formAuth[newProvider];
  const formLabel = busy
    ? form?.kind === "import"
      ? "导入中…"
      : "创建中…"
    : form?.kind === "import"
    ? "导入并打开"
    : form?.kind === "new" && remoteRepo
    ? uncertain
      ? "使用该仓库并打开"
      : "重试克隆并打开"
    : "创建并打开";

  return (
    <View
      style={styles.screen}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.title}>{t("repos")}</Text>
          <View style={styles.actions}>
            {button(syncing ? "同步中" : "同步", manualSync, {
              icon: "RefreshCw",
              disabled: syncing || !settings,
              ghost: true,
            })}
            {button(
              compact ? "导入" : "导入本地文件夹",
              () => openForm({ kind: "import" }),
              {
                icon: "FolderOpen",
                disabled: !!busy || !settings,
                accessibilityLabel: "导入本地文件夹",
              }
            )}
            {button("新建仓库", () => openForm({ kind: "new" }), {
              icon: "Plus",
              primary: true,
              disabled: !!busy || !settings,
            })}
          </View>
        </View>
        <View style={styles.search}>
          <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
          <TextInput
            accessibilityLabel="搜索仓库"
            placeholder="搜索仓库名称或描述"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={[
              styles.input,
              focusedInput === "search" && styles.inputFocused,
            ]}
            onFocus={() => setFocusedInput("search")}
            onBlur={() =>
              setFocusedInput((current) =>
                current === "search" ? undefined : current
              )
            }
            value={search}
            onChangeText={(value) => {
              if (search !== value) {
                request.current++;
                setSearch(value);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.filters}>
          <View style={styles.actions}>
            {(["all", "github", "gitlab"] as const).map((value) => (
              <View key={value}>
                {button(
                  value === "all"
                    ? "全部"
                    : value === "github"
                    ? "GitHub"
                    : "GitLab",
                  () => {
                    if (provider !== value) {
                      request.current++;
                      setProvider(value);
                    }
                  },
                  { ghost: provider !== value, size: "xs" }
                )}
              </View>
            ))}
          </View>
          {button(
            localFilter === "all"
              ? "全部状态"
              : localFilter === "local"
              ? "已在本地"
              : "未克隆",
            () =>
              setLocalFilter(
                localFilter === "all"
                  ? "local"
                  : localFilter === "local"
                  ? "remote"
                  : "all"
              ),
            { icon: "ListFilter", ghost: true, size: "xs" }
          )}
        </View>
        {loadError ? (
          <View style={styles.field}>
            <Text style={styles.error}>{loadError}</Text>
            {button("重试", manualSync, { ghost: true, disabled: syncing })}
          </View>
        ) : null}
        {settingsState.status !== "ready" &&
        settingsState.status !== "loading" ? (
          <Text style={styles.error}>请先检查插件设置</Text>
        ) : null}
      </View>
      <ScrollView style={{ flex: 1 }}>
        {loading && repos.length === 0 ? (
          <View style={styles.empty}>
            <ActivityIndicator color={theme.colors.foregroundMuted} />
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.muted}>
              {search || localFilter !== "all" ? "没有匹配的仓库" : "暂无仓库"}
            </Text>
          </View>
        ) : (
          visible.map((repo) => (
            <View key={repo.id}>
              <View style={styles.row}>
                <Icon
                  icon={providerIcons[repo.provider] || "FolderGit2"}
                  size={18}
                  color={theme.colors.foregroundMuted}
                />
                <View style={styles.repoInfo}>
                  <View
                    style={[styles.actions, { flexWrap: "nowrap", gap: 6 }]}
                  >
                    <Text numberOfLines={1} style={styles.name}>
                      {repo.fullName}
                    </Text>
                    {repo.isPrivate ? (
                      <Icon
                        name="LockKeyhole"
                        size={12}
                        color={theme.colors.foregroundMuted}
                      />
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.muted}>
                    {repo.description ||
                      (repo.provider === "github" ? "GitHub" : "GitLab")}
                  </Text>
                </View>
                <Text style={[styles.status, repo.isLocal && styles.local]}>
                  {repo.isLocal ? "已在本地" : "未克隆"}
                </Text>
                {button(
                  busy === repo.id
                    ? "创建中…"
                    : compact
                    ? ""
                    : repo.isLocal
                    ? "创建工作区"
                    : "克隆并创建",
                  () => quickCreate(repo),
                  {
                    size: "xs",
                    icon: compact ? "ArrowRight" : undefined,
                    disabled: !!busy || !settings,
                    accessibilityLabel: `${
                      repo.isLocal ? "创建工作区" : "克隆并创建"
                    } ${repo.fullName}`,
                  }
                )}
                {button("", () => openForm({ kind: "options", repo }), {
                  size: "xs",
                  icon: "Ellipsis",
                  ghost: true,
                  disabled: !!busy || !settings,
                  accessibilityLabel: `更多选项 ${repo.fullName}`,
                })}
              </View>
              {rowError?.id === repo.id ? (
                <Text
                  style={[
                    styles.error,
                    {
                      paddingHorizontal: compact ? 16 : 24,
                      paddingVertical: 8,
                    },
                  ]}
                >
                  {rowError.text}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.muted}>GitHub · {accountText(auth.github)}</Text>
        <Text style={styles.muted}>GitLab · {accountText(auth.gitlab)}</Text>
        {syncedAt ? (
          <Text style={styles.muted}>
            同步于{" "}
            {new Date(syncedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        ) : null}
      </View>
      <Modal
        title={formTitle}
        open={!!form}
        onOpenChange={(open) => {
          if (!open && !lock.current) {
            folderRequest.current++;
            setForm(null);
          }
        }}
      >
        <Modal.Content>
          <View style={styles.form}>
            {form?.kind === "new" ? (
              <>
                <View style={styles.actions}>
                  {(["github", "gitlab"] as const).map((value) => (
                    <View key={value}>
                      {button(
                        value === "github" ? "GitHub" : "GitLab",
                        () => {
                          if (newProvider !== value)
                            formOperation.current = newOperationId();
                          setNewProvider(value);
                          setFormError("");
                        },
                        {
                          accessibilityLabel: `创建到 ${
                            value === "github" ? "GitHub" : "GitLab"
                          }`,
                          ghost: newProvider !== value,
                          disabled: !!busy || !!remoteRepo,
                        }
                      )}
                    </View>
                  ))}
                </View>
                {newProvider === "gitlab" ? (
                  <View style={styles.field}>
                    {(() => {
                      const options = [
                        {
                          label: groupsLoading ? "加载分组中…" : "个人空间",
                          value: "personal",
                        },
                        ...groups.map((group) => ({
                          label: group.fullPath,
                          value: String(group.id),
                        })),
                        ...(namespace !== "personal" &&
                        !groups.some((group) => String(group.id) === namespace)
                          ? [
                              {
                                label: "分组不可用，请重新选择",
                                value: namespace,
                              },
                            ]
                          : []),
                      ];
                      const disabled =
                        !!busy ||
                        !!remoteRepo ||
                        groupsLoading ||
                        !!groupsError;
                      const onValueChange = (value: string) => {
                        setNamespace(value);
                        setFormError("");
                        formOperation.current = newOperationId();
                      };
                      return Platform.OS === "web" ? (
                        <>
                          <Text style={styles.label}>创建位置</Text>
                          <select
                            aria-label="创建位置"
                            value={namespace}
                            disabled={disabled}
                            onChange={(event) =>
                              onValueChange(
                                (event.target as unknown as { value: string })
                                  .value
                              )
                            }
                            onFocus={() => setFocusedInput("namespace")}
                            onBlur={() =>
                              setFocusedInput((current) =>
                                current === "namespace" ? undefined : current
                              )
                            }
                            style={{
                              boxSizing: "border-box",
                              width: "100%",
                              height: 32,
                              padding: "5px 12px",
                              borderRadius: 6,
                              border: `1px solid ${
                                focusedInput === "namespace"
                                  ? theme.colors.border
                                  : "transparent"
                              }`,
                              backgroundColor: theme.colors.surface2,
                              color: theme.colors.foreground,
                              fontFamily: "inherit",
                              fontSize: 14,
                              lineHeight: "20px",
                              opacity: disabled ? 0.5 : 1,
                              outline:
                                focusedInput === "namespace"
                                  ? `2px solid ${theme.colors.accent}`
                                  : "none",
                              outlineOffset: 1,
                            }}
                          >
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <SettingsSelect<string>
                          label="创建位置"
                          value={namespace}
                          options={options}
                          onValueChange={onValueChange}
                          disabled={disabled}
                        />
                      );
                    })()}
                    {groupsError ? (
                      <View style={styles.field}>
                        <Text style={styles.error}>{groupsError}</Text>
                        {button("重试加载分组", loadGroups, {
                          disabled: !!busy || groupsLoading,
                        })}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.field}>
                  <Text style={styles.label}>仓库名称</Text>
                  <TextInput
                    accessibilityLabel="仓库名称"
                    style={[
                      styles.input,
                      { flex: 0 },
                      (!!busy || (!!remoteRepo && !uncertain)) &&
                        styles.inputDisabled,
                      focusedInput === "name" && styles.inputFocused,
                    ]}
                    onFocus={() => setFocusedInput("name")}
                    onBlur={() =>
                      setFocusedInput((current) =>
                        current === "name" ? undefined : current
                      )
                    }
                    value={name}
                    onChangeText={(value) => {
                      setName(value);
                      setFormError("");
                      if (uncertain) {
                        setRemoteRepo(undefined);
                        setUncertain(false);
                      }
                      formOperation.current = newOperationId();
                    }}
                    placeholder="my-project"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    editable={!busy && (!remoteRepo || uncertain)}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <View style={styles.heading}>
                  <Text style={styles.label}>公开仓库</Text>
                  <Switch
                    accessibilityLabel="公开仓库"
                    value={isPublic}
                    onValueChange={setPublic}
                    disabled={!!busy || !!remoteRepo}
                  />
                </View>
                {isPublic ? (
                  <Text style={styles.muted}>任何人都可以查看该仓库</Text>
                ) : null}
                <Text style={styles.muted}>
                  {newAuth?.loggedIn
                    ? `@${newAuth.user} · ${
                        newProvider === "github"
                          ? "github.com"
                          : gitlabUrl
                              .replace(/^https?:\/\//, "")
                              .replace(/\/.*$/, "")
                      }`
                    : accountText(newAuth)}
                </Text>
                {!authRefreshing && !newAuth?.loggedIn
                  ? button("重新检查登录", refreshFormAuth, {
                      disabled: !!busy,
                    })
                  : null}
              </>
            ) : form?.kind === "import" ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>文件夹</Text>
                  <View style={styles.search}>
                    <TextInput
                      accessibilityLabel="文件夹路径"
                      placeholder="选择或输入文件夹路径"
                      placeholderTextColor={theme.colors.foregroundMuted}
                      style={[
                        styles.input,
                        !!busy && styles.inputDisabled,
                        focusedInput === "folder" && styles.inputFocused,
                      ]}
                      onFocus={() => setFocusedInput("folder")}
                      onBlur={() =>
                        setFocusedInput((current) =>
                          current === "folder" ? undefined : current
                        )
                      }
                      value={folderPath}
                      onChangeText={setFolderPath}
                      editable={!busy}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {button(browsing ? "加载中" : "浏览", () => browse(), {
                      icon: "FolderOpen",
                      disabled: !!busy || browsing,
                    })}
                  </View>
                </View>
                {folders ? (
                  <View style={styles.field}>
                    <Text style={styles.muted}>{folders.path}</Text>
                    {folders.path !== folders.parent
                      ? button("上级目录", () => browse(folders.parent), {
                          icon: "ArrowUp",
                          ghost: true,
                          disabled: browsing,
                        })
                      : null}
                    <ScrollView style={{ maxHeight: 240 }}>
                      {folders.directories.map((folder) => (
                        <Pressable
                          key={folder.path}
                          accessibilityRole="button"
                          accessibilityLabel={`进入 ${folder.name}`}
                          disabled={browsing}
                          onPress={() => browse(folder.path)}
                          style={styles.folder}
                        >
                          <Icon
                            name="Folder"
                            size={16}
                            color={theme.colors.foregroundMuted}
                          />
                          <Text numberOfLines={1} style={styles.name}>
                            {folder.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                    {button(
                      "选择此文件夹",
                      () => {
                        setFolderPath(folders.path);
                        setFolders(null);
                      },
                      { disabled: browsing }
                    )}
                  </View>
                ) : null}
              </>
            ) : form?.kind === "options" ? (
              <>
                <Text style={styles.name}>{form.repo.fullName}</Text>
                <Text style={styles.muted}>{form.repo.localPath}</Text>
                <Text style={styles.muted}>
                  起始分支 · {form.repo.defaultBranch || "默认分支"}
                </Text>
                <SettingsSelect<"local" | "worktree">
                  label="工作区类型"
                  value={optionIsolation}
                  onValueChange={setOptionIsolation}
                  options={[
                    { label: "Worktree", value: "worktree" },
                    { label: "Local", value: "local" },
                  ]}
                  disabled={!!busy}
                />
                <SettingsSelect<"ssh" | "https">
                  label="克隆协议"
                  value={optionProtocol}
                  onValueChange={setOptionProtocol}
                  options={[
                    { label: "SSH", value: "ssh" },
                    { label: "HTTPS", value: "https" },
                  ]}
                  disabled={!!busy}
                />
              </>
            ) : null}
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <View style={[styles.actions, { justifyContent: "flex-end" }]}>
              {button(
                "取消",
                () => {
                  folderRequest.current++;
                  setForm(null);
                },
                { disabled: !!busy, ghost: true }
              )}
              {button(formLabel, submitForm, {
                primary: true,
                disabled:
                  !!busy ||
                  browsing ||
                  (form?.kind === "new" &&
                    !remoteRepo &&
                    (!name.trim() ||
                      (newProvider === "gitlab" &&
                        (groupsLoading ||
                          !!groupsError ||
                          (namespace !== "personal" &&
                            !groups.some(
                              (group) => String(group.id) === namespace
                            )))) ||
                      authRefreshing ||
                      !newAuth?.loggedIn ||
                      !newAuth.user)) ||
                  (form?.kind === "import" && !folderPath.trim()),
              })}
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import {
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsAction,
} from "@getpaseo/plugin/client/ui";
import { gitWorkspaceSettings } from "../shared/settings";

type ReadySettings = Extract<
  SettingsState<typeof gitWorkspaceSettings.schema>,
  { status: "ready" }
>;

const AUTOSAVE_DELAY_MS = 600;

function SettingsEditor({
  settings,
  theme,
}: {
  settings: ReadySettings;
  theme: PluginSurfaceProps["theme"];
}) {
  const [draft, setDraft] = useState(() => settings.values);

  const changeGitlabUrl = useCallback(
    (gitlabUrl: string) => setDraft((current) => ({ ...current, gitlabUrl })),
    [],
  );

  const changeCloneDir = useCallback(
    (cloneDir: string) => setDraft((current) => ({ ...current, cloneDir })),
    [],
  );

  const changeCloneProtocol = useCallback(
    (cloneProtocol: "ssh" | "https") => setDraft((current) => ({ ...current, cloneProtocol })),
    [],
  );

  const changeDefaultIsolation = useCallback(
    (defaultIsolation: "worktree" | "local") => setDraft((current) => ({ ...current, defaultIsolation })),
    [],
  );

  const dirty =
    draft.gitlabUrl !== settings.values.gitlabUrl ||
    draft.cloneDir !== settings.values.cloneDir ||
    draft.cloneProtocol !== settings.values.cloneProtocol ||
    draft.defaultIsolation !== settings.values.defaultIsolation;

  useEffect(() => {
    if (!dirty || settings.saving || settings.saveError) return;
    const timer = setTimeout(() => {
      void settings.save(draft, settings.revision);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, settings, draft]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          padding: 16,
          gap: 16,
        },
        savingText: {
          fontSize: 12,
          color: theme.colors.accent,
          marginTop: 8,
        },
        errorText: {
          fontSize: 12,
          color: theme.colors.statusDanger,
          marginTop: 8,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.container}>
      <SettingsSection title="GitLab">
        <SettingsCard>
          <SettingsInput
            label="GitLab URL"
            hint="实例域名，如 https://gitlab.com 或私有域名"
            initialValue={draft.gitlabUrl}
            onChangeText={changeGitlabUrl}
            placeholder="https://gitlab.com"
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="本地路径与克隆">
        <SettingsCard>
          <SettingsInput
            label="本地代码目录"
            hint="仓库存储根路径"
            initialValue={draft.cloneDir}
            onChangeText={changeCloneDir}
            placeholder="~/Projects"
            disabled={settings.saving}
          />

          <SettingsSelect<"ssh" | "https">
            label="克隆协议"
            value={draft.cloneProtocol}
            options={[
              { label: "SSH (git@...)", value: "ssh" },
              { label: "HTTPS", value: "https" },
            ]}
            onValueChange={changeCloneProtocol}
            disabled={settings.saving}
          />

          <SettingsSelect<"worktree" | "local">
            label="工作区类型"
            value={draft.defaultIsolation}
            options={[
              { label: "Worktree (推荐)", value: "worktree" },
              { label: "Local 目录", value: "local" },
            ]}
            onValueChange={changeDefaultIsolation}
            disabled={settings.saving}
          />
        </SettingsCard>
      </SettingsSection>

      {settings.saving ? (
        <Text style={styles.savingText}>正在保存...</Text>
      ) : null}
      {settings.saveError ? (
        <Text style={styles.errorText}>保存失败: {settings.saveError}</Text>
      ) : null}
    </View>
  );
}

export function GitWorkspaceSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(gitWorkspaceSettings);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: {
          flex: 1,
          backgroundColor: theme.colors.surface0,
          padding: 16,
        },
        infoText: {
          color: theme.colors.foregroundMuted,
          fontSize: 14,
        },
        errorText: {
          color: theme.colors.statusDanger,
          fontSize: 14,
        },
      }),
    [theme],
  );

  if (settings.status === "loading") {
    return (
      <View style={styles.screen}>
        <Text style={styles.infoText}>加载中...</Text>
      </View>
    );
  }

  if (settings.status !== "ready") {
    return (
      <View style={styles.screen}>
        <Text style={styles.errorText}>加载失败: {settings.error}</Text>
        <SettingsAction
          label="重试"
          actionLabel="重新加载"
          onPress={settings.reload}
        />
      </View>
    );
  }

  return <SettingsEditor settings={settings} theme={theme} />;
}

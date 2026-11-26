import { useCallback, useEffect, useState } from "react";
import { useSettings, useTranslation, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { gitWorkspaceSettings } from "../shared/settings";
import { messages } from "./messages";

type EditorSettings = Extract<
  SettingsState<typeof gitWorkspaceSettings.schema>,
  { status: "ready" | "loading" }
>;

const AUTOSAVE_DELAY_MS = 600;

function SettingsEditor({ settings }: { settings: EditorSettings }) {
  const { t } = useTranslation(messages);
  const [draft, setDraft] = useState(() =>
    settings.status === "ready" ? settings.values : gitWorkspaceSettings.schema.parse({}),
  );

  const changeGitlabUrl = useCallback(
    (gitlabUrl: string) => setDraft((current) => ({ ...current, gitlabUrl })),
    [],
  );

  const changeCloneDir = useCallback(
    (cloneDir: string) => setDraft((current) => ({ ...current, cloneDir })),
    [],
  );

  const changeCloneProtocol = useCallback(
    (cloneProtocol: "" | "ssh" | "https") => {
      if (cloneProtocol) setDraft((current) => ({ ...current, cloneProtocol }));
    },
    [],
  );

  const changeDefaultIsolation = useCallback(
    (defaultIsolation: "" | "worktree" | "local") => {
      if (defaultIsolation) setDraft((current) => ({ ...current, defaultIsolation }));
    },
    [],
  );

  const dirty = settings.status === "ready" && (
    draft.gitlabUrl !== settings.values.gitlabUrl ||
    draft.cloneDir !== settings.values.cloneDir ||
    draft.cloneProtocol !== settings.values.cloneProtocol ||
    draft.defaultIsolation !== settings.values.defaultIsolation
  );

  useEffect(() => {
    if (settings.status !== "ready" || !dirty || settings.saving || settings.saveError) return;
    const timer = setTimeout(() => {
      void settings.save(draft, settings.revision);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, settings, draft]);

  const loading = settings.status === "loading";
  const disabled = loading || settings.saving;
  const loadingOption = [{ label: t("settings.loading"), value: "" as const }];

  return (
    <>
      <SettingsSection title="GitLab">
        <SettingsCard>
          <SettingsInput
            label={t("settings.gitLabUrl")}
            hint={t("settings.gitLabHint")}
            initialValue={loading ? undefined : draft.gitlabUrl}
            onChangeText={changeGitlabUrl}
            placeholder={loading ? t("settings.loading") : "https://gitlab.com"}
            disabled={disabled}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.local")}>
        <SettingsCard>
          <SettingsInput
            label={t("settings.cloneDir")}
            hint={t("settings.cloneDirHint")}
            initialValue={loading ? undefined : draft.cloneDir}
            onChangeText={changeCloneDir}
            placeholder={loading ? t("settings.loading") : "~/Projects"}
            disabled={disabled}
          />
          <SettingsSelect
            label={t("settings.cloneProtocol")}
            value={loading ? "" : draft.cloneProtocol}
            options={loading ? loadingOption : [
              { label: "SSH (git@...)", value: "ssh" },
              { label: "HTTPS", value: "https" },
            ]}
            onValueChange={changeCloneProtocol}
            disabled={disabled}
          />
          <SettingsSelect
            label={t("settings.workspaceType")}
            value={loading ? "" : draft.defaultIsolation}
            options={loading ? loadingOption : [
              { label: t("settings.worktree"), value: "worktree" },
              { label: t("settings.localDirectory"), value: "local" },
            ]}
            onValueChange={changeDefaultIsolation}
            disabled={disabled}
          />
          {settings.saveError ? (
            <SettingsRow label={t("settings.title")} error={t("settings.saveFailed")} />
          ) : settings.saving ? (
            <SettingsRow label={t("settings.saving")} />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

export function GitWorkspaceSettings() {
  const settings = useSettings(gitWorkspaceSettings);
  const { t } = useTranslation(messages);
  if (settings.status === "ready" || settings.status === "loading") {
    return <SettingsEditor key={settings.status} settings={settings} />;
  }

  return (
    <SettingsSection title={t("settings.title")}>
      <SettingsCard>
        <SettingsAction
          label={t("settings.title")}
          actionLabel={t("settings.retry")}
          error={t("settings.loadFailed")}
          onPress={settings.reload}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

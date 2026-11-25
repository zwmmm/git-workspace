import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { GitWorkspaceSurface } from "./git-workspace-surface";
import { ProjectsSurface } from "./projects-surface";
import { messages } from "./messages";
import { projectMessages } from "./project-messages";

export function WorkspaceBrowserSurface(props: PluginSurfaceProps) {
  const [view, setView] = useState<"repos" | "projects">("repos"), [busy, setBusy] = useState(false);
  const { t } = useTranslation(messages), { t: projectText } = useTranslation(projectMessages);
  useEffect(() => { setBusy(false); }, [props.host.id]);
  const tabs = <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
    {(["repos", "projects"] as const).map((value, index) => <View key={value} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {index ? <Text style={{ color: props.theme.colors.foregroundMuted, opacity: 0.5 }}>/</Text> : null}
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === value, disabled: busy }}
        accessibilityLabel={value === "repos" ? t("repos") : projectText("projects")} disabled={busy} onPress={() => setView(value)}>
        <Text style={{ fontSize: 20, fontWeight: "500", color: view === value ? props.theme.colors.foreground : props.theme.colors.foregroundMuted }}>
          {value === "repos" ? t("repos") : projectText("projects")}
        </Text>
      </Pressable>
    </View>)}
  </View>;
  return view === "repos" ? <GitWorkspaceSurface {...props} tabs={tabs} onBusyChange={setBusy} /> :
    <ProjectsSurface {...props} tabs={tabs} onBusyChange={setBusy} />;
}

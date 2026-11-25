import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { getPaseoClient, useHosts, usePaseo, useRpc, useTranslation, type PluginHostSummary, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { DeleteProjectRpc, GetProjectDeletionResultRpc, InspectProjectDeletionRpc, readProjectState, type ProjectItem } from "../shared/projects";
import { findProjectHostRpc } from "./project-host-rpc";
import { projectMessages } from "./project-messages";

type Result = { id: string; name: string; status: "removed" | "skipped" | "failed" | "unknown" | "partial"; message?: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

type ProjectsProps = PluginSurfaceProps & {
  tabs?: ReactNode; onBusyChange?: (busy: boolean) => void;
};

export function ProjectsSurface(props: ProjectsProps) {
  const { host } = props;
  const hosts = useHosts();
  const [selection, setSelection] = useState<{ origin: string; target: string }>();
  const currentHost = hosts.find(item => item.serverId === host.id) ??
    { serverId: host.id, label: host.label, status: "online" as const };
  const options = [currentHost, ...hosts.filter(item => item.serverId !== host.id)];
  const target = (selection?.origin === host.id && options.find(item => item.serverId === selection.target)) || currentHost;
  return <HostProjectsSurface key={JSON.stringify([host.id, target.serverId, target.status === "online"])} {...props}
    host={{ id: target.serverId, label: target.label }} hosts={options} remote={target.serverId !== host.id}
    offline={target.status !== "online"}
    onHostChange={id => setSelection({ origin: host.id, target: id })} />;
}

function HostProjectsSurface({ theme, host, layout, tabs, onBusyChange, hosts, remote, offline, onHostChange }: ProjectsProps & {
  hosts: readonly PluginHostSummary[]; remote: boolean; offline: boolean; onHostChange: (id: string) => void;
}) {
  const paseo = usePaseo();
  const inspectLocal = useRpc(InspectProjectDeletionRpc), removeLocal = useRpc(DeleteProjectRpc);
  const resultLocal = useRpc(GetProjectDeletionResultRpc);
  const remoteRpc = useRef<Awaited<ReturnType<typeof findProjectHostRpc>>>(null);
  const toast = useToast();
  const resolvePaseo = useCallback(() => remote ? getPaseoClient(host.id) : paseo, [remote, host.id, paseo]);
  const offlineRef = useRef(offline); offlineRef.current = offline;
  const { t } = useTranslation(projectMessages);
  const [projects, setProjects] = useState<ProjectItem[]>([]), [selected, setSelected] = useState(new Set<string>());
  const [search, setSearch] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [canDelete, setCanDelete] = useState(false), [actionError, setActionError] = useState("");
  const [confirmation, setConfirmation] = useState<ProjectItem[] | null>(null);
  const [busy, setBusy] = useState<"inspect" | "delete" | null>(null);
  const [results, setResults] = useState<Result[]>([]), [progress, setProgress] = useState({ done: 0, total: 0, name: "" });
  const [stopping, setStopping] = useState(false), [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(layout.compact ? 400 : 1000);
  const compact = width < 680;
  const lock = useRef(false), stop = useRef(false), alive = useRef(true), request = useRef(0);
  const inFlight = useRef<object | null>(null);
  const scope = useRef({ host: host.id, paseo });
  if (scope.current.host !== host.id || scope.current.paseo !== paseo) scope.current = { host: host.id, paseo };
  const context = scope.current;
  const current = () => alive.current && scope.current === context;

  const load = useCallback(async () => {
    if (offlineRef.current || lock.current || inFlight.current === context) return;
    inFlight.current = context;
    const id = ++request.current;
    setLoading(true);
    try {
      const rows = await readProjectState(resolvePaseo());
      if (!current() || id !== request.current) return;
      setProjects(rows); setError("");
      setResults(old => old.map(result => result.status === "unknown" && !rows.some(p => p.id === result.id)
        ? { ...result, status: "removed", message: undefined } : result));
      setSelected(old => new Set([...old].filter(value => rows.some(p => p.id === value && !p.blocked))));
    } catch (cause) {
      if (current() && id === request.current) setError(errorText(cause));
    } finally {
      if (inFlight.current === context) inFlight.current = null;
      if (current() && id === request.current) setLoading(false);
    }
  }, [context, resolvePaseo]);
  const checkCapability = useCallback(async () => {
    if (offlineRef.current) return;
    const input = { hostId: host.id, projectIds: [] };
    try {
      let rpc: Awaited<ReturnType<typeof findProjectHostRpc>> = null;
      if (remote) {
        rpc = await findProjectHostRpc(host.id);
        if (!current() || offlineRef.current) return;
      }
      if (rpc) await rpc(InspectProjectDeletionRpc, input);
      else {
        // The daemon can verify the selected ID even if the page did not resolve its installation.
        try { await inspectLocal(input); }
        catch (cause) {
          if (!remote) throw cause;
          throw new Error(t("remoteDeletionUnavailable"));
        }
      }
      if (current()) { remoteRpc.current = rpc; setCanDelete(true); setActionError(""); }
    } catch (cause) {
      if (current()) { remoteRpc.current = null; setCanDelete(false); setActionError(errorText(cause)); }
    }
  }, [context, inspectLocal, remote]);
  useEffect(() => {
    alive.current = true; lock.current = false; stop.current = false;
    setProjects([]); setSelected(new Set()); setSearch(""); setError(""); setConfirmation(null);
    setBusy(null); setResults([]); setStopping(false); setCanDelete(false); setActionError("");
    if (offline) { setLoading(false); return; }
    void load(); void checkCapability();
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = resolvePaseo().projects.subscribe(() => { void load(); }); }
    catch { /* The list request reports a broken connection. */ }
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => { alive.current = false; stop.current = true; request.current++; unsubscribe?.(); clearInterval(timer); };
  }, [context, load, checkCapability, offline, resolvePaseo]);
  useEffect(() => { onBusyChange?.(busy !== null); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  const visible = projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(search.toLowerCase()));
  const unconfirmed = new Set(results.filter(r => r.status === "unknown").map(r => r.id));
  const eligible = visible.filter(p => !p.blocked && !unconfirmed.has(p.id));
  const allSelected = eligible.length > 0 && eligible.every(p => selected.has(p.id));
  const disabled = Boolean(busy || loading || error || offline || !canDelete);
  const blockedText = (p: ProjectItem) => p.blocked ? t(p.blocked === "running" ? "running" : p.blocked === "terminal" ? "terminal" : "archiving") : unconfirmed.has(p.id) ? t("unknown") : "";

  async function prepare() {
    if (lock.current || !selected.size || offlineRef.current || !canDelete) return;
    const rpc = remoteRpc.current;
    lock.current = true; setBusy("inspect"); setActionError("");
    try {
      const input = { hostId: host.id, projectIds: [...selected] };
      const result = rpc ? await rpc(InspectProjectDeletionRpc, input) : await inspectLocal(input);
      if (current()) setConfirmation(result.projects);
    } catch (cause) { if (current()) setActionError(errorText(cause)); }
    finally { if (current()) { lock.current = false; setBusy(null); } }
  }
  async function execute() {
    if (lock.current || !confirmation?.length || offlineRef.current || !canDelete) return;
    const rpc = remoteRpc.current;
    const targets = confirmation;
    lock.current = true; stop.current = false; setStopping(false); setBusy("delete");
    setConfirmation(null); setSelected(new Set()); setResults([]); setActionError("");
    setProgress({ done: 0, total: targets.length, name: targets[0].name });
    const output: Result[] = [];
    for (const target of targets) {
      if (!current()) break;
      if (stop.current || offlineRef.current) output.push({ id: target.id, name: target.name, status: "skipped", message: t("stopped") });
      else {
        setProgress({ done: output.length, total: targets.length, name: target.name });
        const operationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
          const input = { hostId: host.id, projectId: target.id, snapshot: target.snapshot, operationId };
          const result = rpc ? await rpc(DeleteProjectRpc, input) : await removeLocal(input);
          output.push({ id: target.id, name: target.name, ...result });
        } catch (cause) {
          let recovered: Awaited<ReturnType<typeof resultLocal>> = null;
          try {
            const input = { hostId: host.id, operationId };
            if (current()) recovered = rpc ? await rpc(GetProjectDeletionResultRpc, input) : await resultLocal(input);
          } catch { /* Read-only recovery failed; retain the uncertain result. */ }
          output.push({ id: target.id, name: target.name, ...(recovered ?? { status: "unknown" as const, message: errorText(cause) }) });
        }
      }
      if (!current()) break;
      const last = output[output.length - 1];
      if (last.status === "removed") setProjects(old => old.filter(p => p.id !== target.id));
      setResults([...output]); setProgress({ done: output.length, total: targets.length, name: target.name });
    }
    if (current()) {
      lock.current = false; setBusy(null);
      const removed = output.filter(r => r.status === "removed").length;
      const skipped = output.filter(r => r.status === "skipped").length;
      const failed = output.filter(r => r.status === "failed" || r.status === "partial").length;
      const unknown = output.filter(r => r.status === "unknown").length;
      const message = [t("deletionSuccess", { count: removed })];
      if (skipped) message.push(t("deletionSkipped", { count: skipped }));
      if (failed) message.push(t("deletionFailed", { count: failed }));
      if (unknown) message.push(t("deletionUnknown", { count: unknown }));
      toast.show(message.join(" · "), { variant: skipped || failed || unknown ? "warning" : "success" });
      void load();
    }
  }

  const styles = useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    header: { paddingHorizontal: compact ? 16 : 24, paddingVertical: 20, gap: 16, borderBottomWidth: 1, borderColor: theme.colors.border },
    heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
    title: { fontSize: 20, fontWeight: "500", color: theme.colors.foreground },
    actions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    button: { minHeight: 32, paddingHorizontal: 12, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: theme.colors.surface2 },
    buttonText: { fontSize: 14, color: theme.colors.foreground },
    ghost: { backgroundColor: "transparent" }, muted: { fontSize: 12, color: theme.colors.foregroundMuted },
    danger: { color: theme.colors.statusDanger },
    search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "transparent", backgroundColor: theme.colors.surface2 },
    input: { flex: 1, minWidth: 0, minHeight: 32, paddingVertical: 5, paddingHorizontal: 0, fontSize: 14, lineHeight: 20, color: theme.colors.foreground, backgroundColor: "transparent", ...(Platform.OS === "web" ? { outlineWidth: 0 } : {}) },
    hostOptions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
    hostLabel: { fontSize: 12, color: theme.colors.foregroundMuted, marginRight: 4 },
    hostChip: { minHeight: 28, paddingHorizontal: 10, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 6 },
    activeHostChip: { backgroundColor: theme.colors.surface2 },
    activeHostName: { color: theme.colors.foreground, fontWeight: "500" },
    focused: { borderColor: theme.colors.border, ...(Platform.OS === "web" ? {
      outlineColor: theme.colors.accent, outlineWidth: 2, outlineOffset: 1, outlineStyle: "solid" as const,
    } : {}) },
    row: { flexDirection: "row", alignItems: "center", gap: compact ? 8 : 12, minHeight: 68, paddingHorizontal: compact ? 16 : 24, paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.colors.border },
    selected: { backgroundColor: theme.colors.surface2 }, info: { flex: 1, minWidth: 0, gap: 4 },
    name: { fontSize: 14, fontWeight: "500", color: theme.colors.foreground },
    status: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: theme.colors.surface2, color: theme.colors.foregroundMuted },
    checkbox: { minWidth: 28, minHeight: 32, justifyContent: "center", alignItems: "flex-start" },
    empty: { padding: 32, alignItems: "center", gap: 12 }, result: { paddingHorizontal: compact ? 16 : 24, paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderColor: theme.colors.border },
    modalText: { fontSize: 14, lineHeight: 22, color: theme.colors.foregroundMuted },
  }), [theme, compact]);
  const button = (label: string, action: () => void, options: { disabled?: boolean; danger?: boolean; ghost?: boolean; icon?: string; text?: string } = {}) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={options.disabled} onPress={action}
      style={[styles.button, options.ghost && styles.ghost, options.disabled && { opacity: 0.4 }]}>
      {options.icon ? <Icon name={options.icon} size={14} color={options.danger ? theme.colors.statusDanger : theme.colors.foregroundMuted} /> : null}
      <Text style={[styles.buttonText, options.danger && styles.danger]}>{options.text ?? label}</Text>
    </Pressable>
  );
  const checkbox = (label: string, checked: boolean, mixed: boolean, blocked: boolean, action: () => void) => (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: mixed ? "mixed" : checked, disabled: blocked }} disabled={blocked} onPress={action}
      style={[styles.checkbox, blocked && { opacity: 0.4 }]}>
      <Icon name={mixed ? "SquareMinus" : checked ? "SquareCheck" : "Square"} size={16} color={checked || mixed ? theme.colors.accent : theme.colors.foregroundMuted} />
    </Pressable>
  );
  const workspaceCount = confirmation?.reduce((n, p) => n + p.workspaceCount, 0) ?? 0;
  const agentCount = confirmation?.reduce((n, p) => n + p.agentCount, 0) ?? 0;
  return (
    <View style={styles.screen} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={styles.heading}>
          {tabs ?? <Text style={styles.title}>{t("projects")}</Text>}
          <View style={styles.actions}>
            {button(t("refresh"), () => { setSelected(new Set()); void load(); void checkCapability(); }, { disabled: !!busy || loading, ghost: true, icon: "RefreshCw" })}
            {selected.size ? <Text style={styles.muted}>{t("selected", { count: selected.size })}</Text> : null}
            {selected.size ? button(t("clear"), () => setSelected(new Set()), { disabled: !!busy, ghost: true }) : null}
            {button(t("deleteSelected"), () => { void prepare(); }, { disabled: disabled || !selected.size, danger: true, icon: "Trash2", text: busy === "inspect" ? t("inspect") : t("deleteSelected") })}
          </View>
        </View>
        <View style={[styles.search, focused && styles.focused]}>
          <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
          <TextInput accessibilityLabel={t("search")} placeholder={t("search")} value={search} editable={!busy}
            onChangeText={value => { setSearch(value); setSelected(new Set()); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            placeholderTextColor={theme.colors.foregroundMuted} style={styles.input} autoCapitalize="none" autoCorrect={false} />
        </View>
        <View style={styles.hostOptions}>
          <Text style={styles.hostLabel}>{t("hostFilter")}</Text>
          {hosts.map(item => {
            const active = item.serverId === host.id;
            const unavailable = item.status !== "online";
            const switchingDisabled = !!busy || confirmation !== null;
            return <Pressable key={item.serverId} accessibilityRole="button"
              accessibilityLabel={unavailable ? `${item.label} · ${t("offline")}` : item.label}
              accessibilityState={{ selected: active, disabled: switchingDisabled }} disabled={switchingDisabled}
              onPress={() => { if (!active) onHostChange(item.serverId); }}
              style={[styles.hostChip, active && styles.activeHostChip]}>
              <Text style={[styles.muted, active && styles.activeHostName]}>{item.label}</Text>
              {unavailable ? <Text style={styles.muted}>{t("offlineShort")}</Text> : null}
            </Pressable>;
          })}
        </View>
        <View style={styles.heading}>
          <View style={styles.actions}>
            {checkbox(t("selectAll"), allSelected, selected.size > 0 && !allSelected, disabled || !eligible.length,
              () => setSelected(allSelected ? new Set() : new Set(eligible.map(p => p.id))))}
            <Text style={styles.muted}>{t("selectAll")}</Text>
          </View>
          <View style={styles.actions}><Text style={styles.muted}>{t("host", { host: host.label })}{offline ? ` · ${t("offline")}` : ""}</Text><Text style={styles.muted}>{t("total", { count: visible.length })}</Text></View>
        </View>
        {error || actionError ? <View style={{ gap: 8 }}><Text style={[styles.muted, styles.danger]}>{error || actionError}</Text>{button(t("retry"), () => { void load(); void checkCapability(); }, { disabled: !!busy, ghost: true })}</View> : null}
      </View>
      {busy === "delete" ? <View style={[styles.result, styles.heading]}><Text style={styles.muted}>{t("deleting", progress)}</Text>
        {button(t("stop"), () => { stop.current = true; setStopping(true); }, { disabled: stopping, text: stopping ? t("stopping") : t("stop") })}</View> : null}
      <ScrollView style={{ flex: 1 }}>
        {offline ? <View style={styles.empty}><Text style={styles.muted}>{t("offlineProjects")}</Text></View> :
          loading && !projects.length ? <View style={styles.empty}><ActivityIndicator color={theme.colors.foregroundMuted} /></View> : !visible.length ? error ? null :
          <View style={styles.empty}><Text style={styles.muted}>{t(search ? "noMatches" : "empty")}</Text></View> : visible.map(project => (
            <View key={project.id} style={[styles.row, selected.has(project.id) && styles.selected]}>
              {checkbox(t("selectProject", { name: project.name, path: project.path }), selected.has(project.id), false,
                disabled || !!project.blocked || unconfirmed.has(project.id), () => setSelected(old => {
                  const next = new Set(old); next.has(project.id) ? next.delete(project.id) : next.add(project.id); return next;
                }))}
              {!compact ? <Icon name="FolderGit2" size={18} color={theme.colors.foregroundMuted} /> : null}
              <View style={styles.info}><Text style={styles.name}>{project.name}</Text><Text selectable style={styles.muted}>{project.path}</Text>
                {blockedText(project) ? <Text style={styles.muted}>{blockedText(project)}</Text> : null}</View>
              <Text style={styles.status}>{t("workspaces", { count: project.workspaceCount })}</Text>
            </View>
          ))}
      </ScrollView>
      <Modal open={confirmation !== null} title={t("confirmTitle", { count: confirmation?.length ?? 0 })} onOpenChange={open => { if (!open) setConfirmation(null); }}>
        <Modal.Content><Text style={styles.muted}>{t("host", { host: host.label })}</Text>
          <Text style={styles.modalText}>{workspaceCount || agentCount ? `${t("confirmImpact", { workspaces: workspaceCount, agents: agentCount })} ` : ""}{t("preserve")}</Text>
          <View style={[styles.actions, { justifyContent: "flex-end" }]}>
            {button(t("cancel"), () => setConfirmation(null))}
            {button(t("confirmDelete"), () => { void execute(); }, { danger: true, disabled: !!busy || offline })}
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

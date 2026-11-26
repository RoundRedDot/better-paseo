import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type ViewProps } from "react-native";
import * as PluginClient from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { chatForkRpc, type ChatForkInput, type ForkCursor } from "../../shared/chat-fork-rpc";
import { resolveLanguage, type SettingsLanguagePreference } from "../i18n/settings-strings";
import { ToolbarItem } from "../ui/toolbar-button";
import { radiusV2, space, type ExtendedThemeTokens } from "./theme-tokens";

type UseComposers = (selector: { agentId: string }) => readonly { focus(): Promise<void> }[];
// Composer navigation was added after the SDK version this plugin builds against.
const useForkComposers = "useComposers" in PluginClient && typeof PluginClient.useComposers === "function"
  ? PluginClient.useComposers as UseComposers
  : () => [];

const copy = {
  en: {
    label: "Fork chat from here",
    tab: "New tab",
    workspace: "New workspace",
    workspaceNote: "The new workspace uses the same directory.",
    prompt: "First message in the fork",
    submit: "Create fork",
    busy: "Creating fork…",
    failed: "Could not create the fork.",
    created: "The fork is ready in the workspace list.",
  },
  zh: {
    label: "从此处创建会话分支",
    tab: "新标签页",
    workspace: "新工作区",
    workspaceNote: "新工作区使用同一个目录。",
    prompt: "分支会话的第一条消息",
    submit: "创建分支",
    busy: "正在创建分支…",
    failed: "创建分支失败。",
    created: "分支已创建，可在工作区列表中打开。",
  },
};

type Labels = (typeof copy)[keyof typeof copy];
type Target = ChatForkInput["target"];

function OpenFork({ agentId, fallback, done }: { agentId: string; fallback: string; done(): void }) {
  const composer = useForkComposers({ agentId })[0];
  const toast = useToast();
  const focused = useRef(false);
  useEffect(() => {
    const finish = () => {
      toast.show(fallback, { variant: "success" });
      done();
    };
    if (!composer) {
      const timer = setTimeout(finish, 3500);
      return () => clearTimeout(timer);
    }
    if (focused.current) return;
    focused.current = true;
    void composer.focus().then(done, finish);
  }, [composer, done, fallback, toast]);
  return null;
}

export function ForkReplyButton({ agentId, cursor, tokens, language, compact, onLayout }: {
  agentId: string;
  cursor: ForkCursor;
  tokens: ExtendedThemeTokens;
  language: SettingsLanguagePreference;
  compact: boolean;
  onLayout?: ViewProps["onLayout"];
}) {
  const labels = copy[resolveLanguage(language)];
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolbarItem label="Fork chat from here" accessibilityLabel={labels.label} tokens={tokens}
        onLayout={onLayout} hitSlop={compact ? 10 : 4} onPress={() => setOpen(true)}>
        <Icon name="Split" size={14} color={tokens.foregroundMuted} />
      </ToolbarItem>
      {open ? <ForkDialog agentId={agentId} cursor={cursor} tokens={tokens} labels={labels}
        close={() => setOpen(false)} /> : null}
    </>
  );
}

function ForkDialog({ agentId, cursor, tokens, labels, close }: {
  agentId: string;
  cursor: ForkCursor;
  tokens: ExtendedThemeTokens;
  labels: Labels;
  close(): void;
}) {
  const fork = PluginClient.useRpc(chatForkRpc);
  const [target, setTarget] = useState<Target>("tab");
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<string>();
  const inFlight = useRef(false);
  const attempt = useRef<Pick<ChatForkInput, "target" | "prompt" | "requestKey"> | null>(null);
  const trimmed = prompt.trim();
  const disabled = pending || trimmed.length === 0;

  async function submit() {
    if (inFlight.current || !trimmed) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    if (attempt.current?.target !== target || attempt.current.prompt !== trimmed) {
      attempt.current = { target, prompt: trimmed, requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    try {
      const result = await fork({ agentId, cursor, ...attempt.current });
      setCreated(result.agentId);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : labels.failed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (created) return <OpenFork agentId={created} fallback={labels.created} done={close} />;
  return (
    <Modal title={labels.label} open onOpenChange={(visible) => { if (!visible && !inFlight.current) close(); }}>
      <Modal.Content>
        <View style={styles.targets} accessibilityRole="radiogroup">
          {(["tab", "workspace"] as const).map((value) => (
            <Pressable key={value} testID={`better-paseo-fork-${value}`} accessibilityRole="radio"
              accessibilityState={{ checked: target === value, disabled: pending }} disabled={pending}
              onPress={() => { setTarget(value); setError(undefined); }}
              style={[styles.button, { flex: 1, borderColor: target === value ? tokens.accent : tokens.v2.border }]}>
              <Text style={{ color: tokens.foreground }}>{labels[value]}</Text>
            </Pressable>
          ))}
        </View>
        {target === "workspace" && <Text style={{ color: tokens.foregroundMuted }}>{labels.workspaceNote}</Text>}
        <TextInput testID="better-paseo-fork-prompt" accessibilityLabel={labels.prompt}
          placeholder={labels.prompt} placeholderTextColor={tokens.foregroundMuted}
          value={prompt} editable={!pending} multiline onChangeText={(text) => { setPrompt(text); setError(undefined); }}
          style={[styles.input, { color: tokens.foreground, borderColor: tokens.v2.border, backgroundColor: tokens.surface0 }]} />
        {error && <Text accessibilityRole="alert" style={{ color: tokens.danger }}>{error}</Text>}
        <Pressable testID="better-paseo-fork-submit" accessibilityRole="button"
          accessibilityState={{ disabled, busy: pending }} disabled={disabled} onPress={() => void submit()}
          style={[styles.button, { backgroundColor: tokens.accent, borderColor: tokens.accent, opacity: disabled ? 0.5 : 1 }]}>
          <Text style={{ color: tokens.accentForeground }}>{pending ? labels.busy : labels.submit}</Text>
        </Pressable>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  targets: { flexDirection: "row", gap: space.sm },
  button: {
    minHeight: 44, justifyContent: "center", alignItems: "center",
    paddingHorizontal: space.sm, borderRadius: radiusV2.block, borderWidth: 1,
  },
  input: {
    minHeight: 88, padding: space.sm, textAlignVertical: "top",
    borderRadius: radiusV2.block, borderWidth: 1,
  },
});

import React, { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { frosted } from "./frosted";
import { Rotate } from "./motion";
import { Breathe } from "./breathe";
import { PulseDot } from "./pulse-dot";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { HubCallout } from "./hub-callout";
import { PaseoToolCallout } from "./paseo-tool-callouts";
import { SyntaxHighlightBlock, renderTerminalOutput } from "./syntax-highlight";
import { FileTypeLogo } from "./file-type-logo";
import type { ToolCalloutData } from "../../shared/contracts";

function getToolIconName(tool: string): string {
  if (tool === "git") return "Git";
  if (tool === "paseo") return "Paseo";
  if (tool === "github") return "GitHub";
  if (tool === "bash" || tool === "shell") return "Terminal";
  if (tool === "read") return "Book";
  if (tool === "edit" || tool === "write") return "Pencil";
  if (tool === "thinking") return "Brain";
  if (tool === "eval") return "Play";
  if (tool === "ask") return "HelpCircle";
  if (tool === "mcp") return "Plug";
  if (tool === "task") return "Bot";
  if (tool === "hub") return "Radio";
  return "Wrench";
}

interface ToolCalloutProps {
  data: ToolCalloutData;
  tokens: ExtendedThemeTokens;
  defaultExpanded?: boolean;
  /** Shows a path in the machine's own file manager. */
  onRevealPath?: (path: string) => void;
}

export function ToolCallout({
  data,
  tokens,
  defaultExpanded = true,
  onRevealPath,
}: ToolCalloutProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // A tool without a path, or a host that cannot reveal one, leaves the file
  // name as a plain label rather than a link that does nothing.
  // Every branch below needs a payload. A tool that carries none — a hub op
  // with no parsed record, an unmapped kind — would otherwise draw an empty
  // panel, so the raw output takes over.
  const hasTypedBody =
    data.tool === "bash" ||
    data.tool === "shell" ||
    data.tool === "git" ||
    data.tool === "github" ||
    data.tool === "thinking" ||
    data.tool === "read" ||
    data.tool === "write" ||
    data.tool === "edit" ||
    data.tool === "eval" ||
    (data.tool === "mcp" && Boolean(data.mcp)) ||
    (data.tool === "ask" && Boolean(data.askOptions)) ||
    (data.tool === "task" && Boolean(data.subagent)) ||
    (data.tool === "hub" && Boolean(data.hub)) ||
    (data.tool === "paseo" && Boolean(data.paseo));

  const filePath = data.filePath;
  const revealFile = useMemo(
    () => (onRevealPath && filePath ? () => onRevealPath(filePath) : undefined),
    [onRevealPath, filePath],
  );

  const isSuccess = data.status === "completed";
  const isRunning = data.status === "running";
  const isFailed = data.status === "failed";

  const statusColor = isSuccess ? tokens.success : isRunning ? tokens.accent : tokens.danger;

  const statusBg = isSuccess ? tokens.successBg : isRunning ? tokens.accentBg : tokens.dangerBg;

  const iconColor =
    data.tool === "git" ? "#F05032" : data.tool === "github" ? tokens.foreground : tokens.accent;

  // A reply that matches no offered label is free text the user typed, so it
  // is labelled as such rather than pretending an option was picked.
  const answered = data.askAnswer ?? [];
  const typedReply =
    answered.length > 0 &&
    !answered.some((answer) =>
      (data.askOptions ?? []).some(
        (option) => option.label.trim().toLowerCase() === answer.trim().toLowerCase(),
      ),
    );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginVertical: 4,
          borderRadius: radius.card,
          backgroundColor: tokens.surfaceGlass,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          ...tokens.boxShadow,
          overflow: "hidden",
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: tokens.surface1,
        },
        headerLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
        },
        toolPill: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          fontWeight: "600",
          color: tokens.foregroundSubtle,
          textTransform: "lowercase",
        },
        titleText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "600",
          color: tokens.foreground,
          flexShrink: 1,
        },
        // Commands and file paths are code, so they stay on the mono face to
        // match the tool pill sitting beside them.
        headerRight: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        durationBadge: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
        },
        statusBadge: {
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
          backgroundColor: statusBg,
        },
        statusText: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          color: statusColor,
        },
        chevron: {
          fontSize: 11,
          color: tokens.foregroundMuted,
          marginLeft: 2,
        },
        body: {
          padding: 12,
          backgroundColor: tokens.surface0,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
        },
        // Bash terminal style
        // Terminal style
        terminalWindow: {
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          padding: 10,
          gap: 6,
          ...tokens.boxShadow,
        },
        terminalPrompt: {
          fontSize: 12,
          fontFamily: tokens.fontMono,
          color: tokens.foreground,
        },
        evalOutput: {
          padding: 8,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderLeftWidth: 2,
          borderLeftColor: tokens.borderSubtle,
          gap: 3,
          ...tokens.boxShadow,
        },
        evalOutputLabel: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          color: tokens.foregroundSubtle,
          textTransform: "lowercase",
        },
        evalOutputText: {
          fontFamily: tokens.fontMono,
          fontSize: 11.5,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        terminalOutput: {
          fontFamily: tokens.fontMono,
          fontSize: 11.5,
          lineHeight: 17,
          color: tokens.foregroundMuted,
        },
        silentCommandText: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundSubtle,
          fontStyle: "italic",
        },
        // Ask tool options
        askContainer: {
          gap: 8,
        },
        askPrompt: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundSubtle,
          marginBottom: 4,
        },
        askOptionLabelChosen: {
          color: tokens.foreground,
          fontWeight: "600",
        },
        askAnswerRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
        },
        askAnswerKey: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          color: tokens.foregroundSubtle,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        },
        askAnswerValue: {
          flex: 1,
          fontFamily: tokens.fontUi,
          fontSize: 12.5,
          fontWeight: "600",
          color: tokens.success,
        },
        askOptionCard: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 10,
          borderRadius: radius.block,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          backgroundColor: tokens.surface1,
          ...tokens.boxShadow,
        },
        askOptionCardSelected: {
          borderColor: tokens.accent,
          backgroundColor: tokens.accentBg,
        },
        askOptionLeft: {
          flexDirection: "column",
          gap: 2,
          flex: 1,
        },
        askOptionLabelRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        askOptionLabel: {
          fontFamily: tokens.fontUi,
          fontSize: 13,
          fontWeight: "600",
          color: tokens.foreground,
        },
        recommendedBadge: {
          fontSize: 10,
          fontWeight: "600",
          color: tokens.success,
          backgroundColor: tokens.successBg,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
        },
        askOptionDesc: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundMuted,
        },
        // Subagent card
        subagentCard: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 6,
          ...tokens.boxShadow,
        },
        subagentHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        subagentName: {
          fontFamily: tokens.fontUi,
          fontSize: 13,
          fontWeight: "700",
          color: tokens.foreground,
        },
        subagentModel: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          color: tokens.accent,
        },
        subagentTask: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          color: tokens.foregroundMuted,
          lineHeight: 16,
        },
        // Thinking container
        thinkingContainer: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderLeftWidth: 2,
          borderLeftColor: tokens.accent,
          gap: 6,
          ...tokens.boxShadow,
        },
        thinkingHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        thinkingTitle: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "600",
          color: tokens.foreground,
        },
        thinkingTokenBadge: {
          fontSize: 10,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: radius.chip,
        },
        thinkingText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foregroundMuted,
        },
        thinkingStepsList: {
          marginTop: 4,
          gap: 4,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
        },
        thinkingStepRow: {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 6,
        },
        thinkingStepText: {
          fontFamily: tokens.fontUi,
          flex: 1,
          fontSize: 12,
          lineHeight: 16,
          color: tokens.foregroundMuted,
        },
        // MCP container
        mcpContainer: {
          padding: 12,
          borderRadius: radius.block,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 8,
          ...tokens.boxShadow,
        },
        mcpHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        mcpServerBadge: {
          fontSize: 11,
          fontWeight: "700",
          color: tokens.accent,
          backgroundColor: tokens.accentBg,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        mcpToolName: {
          fontSize: 13,
          fontWeight: "700",
          color: tokens.foreground,
          fontFamily: tokens.fontUi,
        },
        mcpTransportBadge: {
          fontSize: 10,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
        },
        mcpSectionTitle: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: tokens.foregroundSubtle,
        },
        mcpErrorBox: {
          padding: 8,
          borderRadius: radius.block,
          backgroundColor: tokens.dangerBg,
          borderWidth: 1,
          borderColor: tokens.dangerBorder,
          ...tokens.boxShadow,
        },
        mcpErrorText: {
          fontSize: 11,
          color: tokens.danger,
        },
      }),
    [tokens, statusBg, statusColor],
  );

  return (
    <View {...frosted} style={styles.container}>
      <Pressable onPress={() => setExpanded((p) => !p)} style={styles.header}>
        <View style={styles.headerLeft}>
          <Breathe depth={1.08} durationMs={1800}>
            <Glyph name={getToolIconName(data.tool)} size={13} color={iconColor} />
          </Breathe>
          <Text style={styles.toolPill}>{data.tool}</Text>
          {data.filePath ? (
            <Breathe depth={1.08} durationMs={1800}>
              <FileTypeLogo
                filename={data.filePath}
                language={data.language}
                size="sm"
                foregroundColor={tokens.foreground}
              />
            </Breathe>
          ) : null}
          <Text style={styles.titleText} numberOfLines={1}>
            {data.title}
          </Text>
        </View>

        <View style={styles.headerRight}>
          {data.durationMs ? <Text style={styles.durationBadge}>{data.durationMs}ms</Text> : null}

          {data.exitCode !== undefined && data.exitCode !== 0 && (
            <Text style={[styles.durationBadge, { color: tokens.danger }]}>
              exit {data.exitCode}
            </Text>
          )}

          {isFailed && (
            <Text style={{ fontSize: 11, fontWeight: "600", color: tokens.danger }}>failed</Text>
          )}

          {isRunning && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PulseDot color={tokens.accent} size={5} />
              <Text
                style={{
                  fontSize: 11,
                  color: tokens.accent,
                  fontWeight: "500",
                }}
              >
                running
              </Text>
            </View>
          )}

          <Rotate active={expanded}>
            <Breathe depth={1.08} durationMs={1800}>
              <Glyph name="ChevronDown" size={16} color={tokens.foregroundMuted} />
            </Breathe>
          </Rotate>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {(data.tool === "bash" || data.tool === "shell" || data.tool === "git") && (
            <View style={styles.terminalWindow}>
              {(data.shell?.command || data.command) && (
                <SyntaxHighlightBlock
                  code={`$ ${data.shell?.command || data.command}`}
                  language="bash"
                  tokens={tokens}
                  compact
                />
              )}

              {data.shell?.stdout && (
                <Text style={styles.terminalOutput}>
                  {renderTerminalOutput(data.shell.stdout, tokens)}
                </Text>
              )}
              {data.shell?.stderr && (
                <Text style={[styles.terminalOutput, { color: tokens.danger }]}>
                  {data.shell.stderr}
                </Text>
              )}
              {data.output && !data.shell?.stdout && (
                <Text style={styles.terminalOutput}>
                  {renderTerminalOutput(data.output, tokens)}
                </Text>
              )}
              {!data.shell?.stdout && !data.shell?.stderr && !data.output && (
                <Text style={styles.silentCommandText}>
                  {isRunning ? "Waiting for command output…" : "Command completed without output."}
                </Text>
              )}
            </View>
          )}

          {data.tool === "thinking" && (
            <View style={styles.thinkingContainer}>
              <View style={styles.thinkingHeader}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Glyph name="Brain" size={13} color={tokens.accent} />
                  <Text style={styles.thinkingTitle}>
                    {data.thinking?.status === "thinking"
                      ? "Live Reasoning Stream…"
                      : "Reasoning Completed"}
                  </Text>
                </View>
                {data.thinking?.tokenCount ? (
                  <Text style={styles.thinkingTokenBadge}>{data.thinking.tokenCount} tokens</Text>
                ) : null}
              </View>

              <Text style={styles.thinkingText}>
                {data.thinking?.text ||
                  data.code ||
                  data.output ||
                  "Analyzing constraints and formulating steps..."}
              </Text>
              {data.thinking?.steps && data.thinking.steps.length > 0 && (
                <View style={styles.thinkingStepsList}>
                  {data.thinking.steps.map((step, idx) => (
                    <View key={idx} style={styles.thinkingStepRow}>
                      <Text
                        style={{
                          fontSize: 11,
                          color: tokens.foregroundSubtle,
                          fontFamily: tokens.fontMono,
                        }}
                      >
                        {idx + 1}.
                      </Text>
                      <Text style={[styles.thinkingStepText, { color: tokens.foreground }]}>
                        {step}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {data.tool === "mcp" && data.mcp && (
            <View style={styles.mcpContainer}>
              <View style={styles.mcpHeader}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Text style={styles.mcpServerBadge}>{data.mcp.server}</Text>
                  <Text style={styles.mcpToolName}>{data.mcp.tool}</Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {data.mcp.transport && (
                    <Text style={styles.mcpTransportBadge}>{data.mcp.transport}</Text>
                  )}
                  {data.durationMs ? (
                    <Text style={styles.durationBadge}>{data.durationMs}ms</Text>
                  ) : null}
                </View>
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.mcpSectionTitle}>Input Parameters</Text>
                <SyntaxHighlightBlock
                  code={JSON.stringify(data.mcp.arguments, null, 2)}
                  language="json"
                  tokens={tokens}
                  compact
                />
              </View>

              {data.mcp.result !== undefined && (
                <View style={{ gap: 4, marginTop: 4 }}>
                  <Text style={styles.mcpSectionTitle}>Response Payload</Text>
                  <SyntaxHighlightBlock
                    code={
                      typeof data.mcp.result === "string"
                        ? data.mcp.result
                        : JSON.stringify(data.mcp.result, null, 2)
                    }
                    language={typeof data.mcp.result === "string" ? "typescript" : "json"}
                    tokens={tokens}
                    compact
                  />
                </View>
              )}

              {data.mcp.error && (
                <View style={styles.mcpErrorBox}>
                  <Text style={styles.mcpErrorText}>Error: {data.mcp.error}</Text>
                </View>
              )}
            </View>
          )}

          {(data.tool === "read" || data.tool === "write") && (
            <SyntaxHighlightBlock
              code={data.code || "// [Empty content or pending stream]"}
              language={data.language ?? "text"}
              filename={data.filePath ? `${data.filePath} ${data.lineRange || ""}` : undefined}
              tokens={tokens}
              showLineNumbers={Boolean(data.code)}
              onRevealFile={revealFile}
              compact
            />
          )}

          {data.tool === "edit" && (
            <SyntaxHighlightBlock
              code={data.diff || data.code || "// [Edit: diff applied]"}
              language="diff"
              filename={data.filePath}
              tokens={tokens}
              showLineNumbers
              onRevealFile={revealFile}
              compact
            />
          )}

          {data.tool === "eval" && (
            <View style={{ gap: 10 }}>
              {(
                data.cells ?? [
                  {
                    code: data.code || "",
                    language: data.language || "typescript",
                    output: data.output,
                  },
                ]
              ).map((cell, idx) => (
                <View key={idx} style={{ gap: 4 }}>
                  {cell.code ? (
                    <SyntaxHighlightBlock
                      code={cell.code}
                      language={cell.language}
                      filename={cell.title || "Persistent Kernel Cell"}
                      tokens={tokens}
                      showLineNumbers
                      compact
                    />
                  ) : null}
                  {cell.output ? (
                    <View style={styles.evalOutput}>
                      <Text style={styles.evalOutputLabel}>stdout</Text>
                      <Text style={styles.evalOutputText}>
                        {renderTerminalOutput(cell.output, tokens)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {data.tool === "ask" && data.askOptions && (
            <View style={styles.askContainer}>
              <Text style={styles.askPrompt}>
                {answered.length > 0 ? "Options offered:" : "Waiting for a decision:"}
              </Text>
              {data.askOptions.map((opt) => {
                // The answer is whatever the tool reported, so a label match
                // marks the chosen row. A typed reply matches nothing and is
                // shown on its own line below.
                const isChosen = (data.askAnswer ?? []).some(
                  (answer) => answer.trim().toLowerCase() === opt.label.trim().toLowerCase(),
                );
                return (
                  <View
                    key={opt.id}
                    style={[styles.askOptionCard, isChosen && styles.askOptionCardSelected]}
                  >
                    <View style={styles.askOptionLeft}>
                      <View style={styles.askOptionLabelRow}>
                        <Text
                          style={[styles.askOptionLabel, isChosen && styles.askOptionLabelChosen]}
                        >
                          {opt.label}
                        </Text>
                        {opt.recommended ? (
                          <Text style={styles.recommendedBadge}>Recommended</Text>
                        ) : null}
                      </View>
                      {opt.description ? (
                        <Text style={styles.askOptionDesc}>{opt.description}</Text>
                      ) : null}
                    </View>
                    {isChosen ? (
                      <Glyph name="CheckCircle" size={16} color={tokens.success} />
                    ) : (
                      <Glyph name="Circle" size={14} color={tokens.foregroundSubtle} />
                    )}
                  </View>
                );
              })}
              {answered.length > 0 ? (
                <View style={styles.askAnswerRow}>
                  <Text style={styles.askAnswerKey}>{typedReply ? "typed" : "answered"}</Text>
                  <Text style={styles.askAnswerValue}>{answered.join(", ")}</Text>
                </View>
              ) : null}
            </View>
          )}

          {data.tool === "task" && data.subagent && (
            <View style={styles.subagentCard}>
              <View style={styles.subagentHeader}>
                <Text style={styles.subagentName}>
                  Subagent: {data.subagent.name} ({data.subagent.agentType})
                </Text>
                <Text style={styles.subagentModel}>{data.subagent.model}</Text>
              </View>
              <Text style={styles.subagentTask}>{data.subagent.task}</Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    color: tokens.success,
                    fontWeight: "600",
                  }}
                >
                  Status: {data.subagent.status}
                </Text>
                <Text style={{ fontSize: 11, color: tokens.foregroundSubtle }}>
                  Auto-coordinated via hub
                </Text>
              </View>
            </View>
          )}
          {data.tool === "hub" && data.hub && <HubCallout data={data.hub} tokens={tokens} />}
          {data.tool === "paseo" && data.paseo && (
            <PaseoToolCallout data={data.paseo} tokens={tokens} />
          )}

          {!hasTypedBody && (
            <View style={styles.terminalWindow}>
              {data.output ? (
                <Text style={styles.terminalOutput}>
                  {renderTerminalOutput(data.output, tokens)}
                </Text>
              ) : (
                <Text style={styles.silentCommandText}>
                  {isRunning ? "Waiting for output…" : "The call returned no output."}
                </Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

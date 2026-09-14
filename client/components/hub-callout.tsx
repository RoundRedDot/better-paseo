import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Glyph } from "./glyph";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import type { HubData, HubMessageData, HubProcessData, HubJobData } from "../../shared/contracts";

interface HubCalloutProps {
  data: HubData;
  tokens: ExtendedThemeTokens;
}

export function HubCallout({ data, tokens }: HubCalloutProps) {
  if (data.kind === "message") {
    return <HubMessageView data={data.data} tokens={tokens} />;
  }
  if (data.kind === "process") {
    return <HubProcessView data={data.data} tokens={tokens} />;
  }
  return <HubJobsView data={data.data} tokens={tokens} />;
}

function HubMessageView({ data, tokens }: { data: HubMessageData; tokens: ExtendedThemeTokens }) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 8,
          padding: 12,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        },
        routingRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        channelBadge: {
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: tokens.accent,
          backgroundColor: tokens.accentBg,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        agentSender: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.foreground,
        },
        arrow: {
          fontSize: 11,
          color: tokens.foregroundSubtle,
        },
        agentRecipient: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.accent,
        },
        deliveryPill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
          backgroundColor: tokens.successBg,
        },
        deliveryText: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "600",
          color: tokens.success,
        },
        messageBox: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderLeftWidth: 3,
          borderLeftColor: tokens.accent,
        },
        messageText: {
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foreground,
          fontFamily: tokens.fontMono,
        },
        replyBox: {
          marginTop: 4,
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surface0,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 4,
        },
        replyHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        replyAgent: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "700",
          color: tokens.success,
        },
        replyBadge: {
          fontSize: 10,
          color: tokens.foregroundSubtle,
        },
        replyText: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foregroundMuted,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.routingRow}>
          <Glyph name="Radio" size={13} color={tokens.accent} />
          <Text style={styles.channelBadge}>hub {data.op}</Text>
          {data.from ? <Text style={styles.agentSender}>{data.from}</Text> : null}
          {data.to ? <Text style={styles.arrow}>➔</Text> : null}
          {data.to ? <Text style={styles.agentRecipient}>{data.to}</Text> : null}
        </View>

        {data.op === "send" ? (
          <View style={styles.deliveryPill}>
            <Glyph name="CheckCircle" size={11} color={tokens.success} />
            <Text style={styles.deliveryText}>{data.delivered ? "Delivered" : "Queued"}</Text>
          </View>
        ) : null}
      </View>

      {data.message ? (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{data.message}</Text>
        </View>
      ) : null}

      {data.response && (
        <View style={styles.replyBox}>
          <View style={styles.replyHeader}>
            <Text style={styles.replyAgent}>Response{data.to ? ` from ${data.to}` : ""}:</Text>
            <Text style={styles.replyBadge}>Synchronous Reply</Text>
          </View>
          <Text style={styles.replyText}>{data.response}</Text>
        </View>
      )}

      {data.output ? (
        <View style={styles.messageBox}>
          <Text style={styles.messageText}>{data.output}</Text>
        </View>
      ) : null}
    </View>
  );
}

function HubProcessView({ data, tokens }: { data: HubProcessData; tokens: ExtendedThemeTokens }) {
  const isReady = data.status === "ready" || data.status === "running";
  const launch = [data.application, ...(data.args ?? [])].filter(Boolean).join(" ");

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 10,
          padding: 12,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        },
        titleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        processPill: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          fontWeight: "700",
          color: tokens.foreground,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        commandText: {
          fontSize: 12,
          fontFamily: tokens.fontMono,
          color: tokens.foregroundMuted,
        },
        statusRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        portPill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
          backgroundColor: tokens.successBg,
          borderWidth: 1,
          borderColor: tokens.successBorder,
        },
        portDot: {
          width: 6,
          height: 6,
          borderRadius: radius.chip,
          backgroundColor: tokens.success,
        },
        portText: {
          fontSize: 11,
          fontFamily: tokens.fontMono,
          fontWeight: "600",
          color: tokens.success,
        },
        readyLogPill: {
          fontSize: 10,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
          backgroundColor: tokens.surface2,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
        logTerminal: {
          padding: 10,
          borderRadius: radius.block,
          backgroundColor: tokens.surfaceCode,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          gap: 4,
        },
        logLine: {
          fontFamily: tokens.fontMono,
          fontSize: 11,
          lineHeight: 16,
          color: tokens.foregroundMuted,
        },
        rosterRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 5,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
        },
        rosterName: {
          fontFamily: tokens.fontMono,
          fontSize: 12,
          color: tokens.foreground,
          flex: 1,
        },
        rosterFigure: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          color: tokens.foregroundSubtle,
        },
        rosterState: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: radius.chip,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Glyph name="Server" size={14} color={tokens.accent} />
          {/* A roster addresses every process, so it carries a count, not a name. */}
          <Text style={styles.processPill}>
            {data.daemons ? data.op : `${data.op} [${data.name}]`}
          </Text>
          {data.daemons ? (
            <Text style={styles.commandText}>
              {data.daemons.length} {data.daemons.length === 1 ? "process" : "processes"}
            </Text>
          ) : launch ? (
            <Text style={styles.commandText}>{launch}</Text>
          ) : null}
        </View>

        <View style={styles.statusRow}>
          {data.port && isReady ? (
            <View style={styles.portPill}>
              <View style={styles.portDot} />
              <Text style={styles.portText}>:{data.port} ready</Text>
            </View>
          ) : data.status !== "unknown" ? (
            <Text style={styles.readyLogPill}>{data.status}</Text>
          ) : null}

          {data.readyLogPattern ? (
            <Text style={styles.readyLogPill}>match: {data.readyLogPattern}</Text>
          ) : null}
        </View>
      </View>

      {data.recentLogs && data.recentLogs.length > 0 && (
        <View style={styles.logTerminal}>
          {data.recentLogs.map((log, index) => (
            <Text key={index} style={styles.logLine}>
              {log}
            </Text>
          ))}
        </View>
      )}

      {data.daemons && data.daemons.length > 0 && (
        <View>
          {data.daemons.map((row) => {
            const live = row.state === "ready" || row.state === "running";
            return (
              <View key={row.name} style={styles.rosterRow}>
                <Text
                  style={[
                    styles.rosterState,
                    {
                      color: live ? tokens.success : tokens.foregroundMuted,
                      backgroundColor: live ? tokens.successBg : tokens.surface2,
                    },
                  ]}
                >
                  {row.state}
                </Text>
                <Text style={styles.rosterName} numberOfLines={1}>
                  {row.name}
                </Text>
                {typeof row.pid === "number" ? (
                  <Text style={styles.rosterFigure}>pid {row.pid}</Text>
                ) : null}
                {typeof row.exitCode === "number" ? (
                  <Text style={styles.rosterFigure}>exit {row.exitCode}</Text>
                ) : null}
                {row.restarts ? (
                  <Text style={styles.rosterFigure}>{row.restarts} restarts</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function HubJobsView({ data, tokens }: { data: HubJobData; tokens: ExtendedThemeTokens }) {
  // The card reports what the call returned. It offers no controls, because a
  // plugin cannot cancel a job and a button that only edits this view lies.
  const jobs = data.activeJobs;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: radius.card,
          backgroundColor: tokens.surface1,
          borderWidth: 1,
          borderColor: tokens.borderSubtle,
          overflow: "hidden",
          ...tokens.boxShadow,
          gap: 6,
          padding: 12,
        },
        headerRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        },
        headerTitle: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          fontWeight: "700",
          color: tokens.foreground,
        },
        jobCountBadge: {
          fontSize: 11,
          fontWeight: "600",
          fontFamily: tokens.fontUi,
          color: tokens.accent,
          backgroundColor: tokens.accentBg,
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: radius.chip,
        },
        jobRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 6,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
          gap: 8,
        },
        jobLeft: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          flex: 1,
        },
        jobId: {
          fontSize: 11,
          fontFamily: tokens.fontMono,
          fontWeight: "600",
          color: tokens.foregroundMuted,
        },
        jobTarget: {
          fontFamily: tokens.fontUi,
          fontSize: 12,
          color: tokens.foreground,
          flexShrink: 1,
        },
        jobRight: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        jobTimer: {
          fontSize: 11,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundSubtle,
        },
        titleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
      }),
    [tokens],
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Glyph name="Layers" size={14} color={tokens.accent} />
          <Text style={styles.headerTitle}>Hub {data.op}</Text>
        </View>
        <Text style={styles.jobCountBadge}>{jobs.length} active</Text>
      </View>

      {jobs.map((job) => (
        <View key={job.id} style={styles.jobRow}>
          <View style={styles.jobLeft}>
            <Text style={styles.jobId}>{job.id}</Text>
            <Text style={styles.jobTarget} numberOfLines={1}>
              {job.target}
            </Text>
          </View>

          <View style={styles.jobRight}>
            <Text style={styles.jobTimer}>{job.elapsed}</Text>
          </View>
        </View>
      ))}

      {jobs.length === 0 && data.output ? (
        <Text style={styles.jobTarget}>{data.output}</Text>
      ) : null}
    </View>
  );
}

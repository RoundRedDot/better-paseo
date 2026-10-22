/**
 * The tablet's floating bottom panel (design board 2, table 5.2):
 * min(W − 32, 760) wide and centred, all corners 16, 12 above the bottom safe
 * area, the drawer's handle and no dim. It opens at min(content, 0.5 ×
 * available) and goes full at available − 24. On iOS and Android a tap
 * outside closes it (nothing under the Modal reaches the timeline); on web
 * the timeline behind stays live.
 */
import React from "react";
import { Platform } from "react-native";
import { floatingWidth } from "../layout-model";
import { OutsideCatcher } from "./scrim";
import { BottomPanel, FLOATING_GAP, availableHeight } from "./bottom-panel";
import type { FormPanelProps } from "./bottom-drawer";

export function FloatingPanel(props: FormPanelProps) {
  const { onOutside, ...panel } = props;
  const width = floatingWidth(props.stage.width);
  return (
    <BottomPanel
      {...panel}
      form="floating"
      testID="details-floating"
      frame={{ left: Math.round((props.stage.width - width) / 2), width, bottom: FLOATING_GAP + props.insets.bottom }}
      corners="all"
      bottomPad={0}
      available={availableHeight("floating", props.stage.height, props.insets)}
      behind={Platform.OS === "web" ? undefined : () => <OutsideCatcher onPress={onOutside} />}
    />
  );
}

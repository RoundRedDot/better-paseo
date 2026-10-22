/**
 * The phone's details drawer (design board 1, table 5.2): full width against
 * the bottom edge, top corners 16, a handle, the bottom safe area as padding,
 * over a scrim that closes it on a tap.
 */
import React from "react";
import { Scrim } from "./scrim";
import { BottomPanel, availableHeight, type BottomPanelProps } from "./bottom-panel";

export type FormPanelProps = Omit<BottomPanelProps, "form" | "testID" | "frame" | "corners" | "bottomPad" | "available" | "behind"> & {
  /** Native: what closes on a tap outside the panel. */
  onOutside(): void;
};

export function BottomDrawer(props: FormPanelProps) {
  const { onOutside, ...panel } = props;
  return (
    <BottomPanel
      {...panel}
      form="drawer"
      testID="details-drawer"
      frame={{ left: 0, width: props.stage.width, bottom: 0 }}
      corners="top"
      bottomPad={props.insets.bottom}
      available={availableHeight("drawer", props.stage.height, props.insets)}
      behind={(opacity) => <Scrim tokens={props.tokens} opacity={opacity} onPress={onOutside} />}
    />
  );
}

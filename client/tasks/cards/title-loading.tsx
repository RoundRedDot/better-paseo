import { useEffect, useRef, useState } from "react";
import { Animated, Platform, View, type StyleProp, type TextStyle } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { TaskText } from "../typography";

const DURATION = 2600;
/** The band leans this far from upright, from top left to bottom right. */
const TILT_DEG = 30;
const STYLE_ELEMENT_ID = "better-paseo-title-sweep";
const SWEEP_ATTR = "bctitlesweep";

/**
 * ChatGPT's "thinking" shimmer: the title rests in the muted color while a
 * narrow band of light, about a word wide, sweeps across it. The card picks
 * the light (`highlightColor`): towards the card's fill on a light theme, so
 * the glyphs pale but stay readable as it passes, and the text color on a
 * dark one. Web clips
 * one gradient to the glyphs; native has no text mask, so it stacks thin
 * clipped copies of the title whose opacity follows a cos² profile, close
 * enough to a gradient that no band edge shows.
 */
export function TitleLoading(props: {
  title: string;
  titleLines?: number;
  highlightColor: string;
  mutedColor: string;
  style: StyleProp<TextStyle>;
  animated?: boolean;
  accessibilityLabel: string;
}) {
  const reduced = useReducedMotion();
  const active = props.animated !== false && !reduced;
  return Platform.OS === "web" ? <WebSweep {...props} active={active && hasDom()} /> : <NativeSweep {...props} active={active} />;
}

type SweepProps = Parameters<typeof TitleLoading>[0] & { active: boolean };

const containerProps = (props: SweepProps) => ({
  accessibilityLabel: props.accessibilityLabel,
  accessibilityState: { busy: true },
  testID: "task-title-update-shimmer",
  style: { flex: 1, minWidth: 0, overflow: "hidden" as const },
});

/** A real DOM: in a test's bare environment there is nothing to style. */
const hasDom = () => typeof document !== "undefined" && typeof document.getElementById === "function";

function sweepRules(muted: string): string {
  // The light is `currentColor`: each card sets it inline, as its fill changes on hover.
  // On a 300% background the band spans about a fifth of the title's width.
  const mix = (share: number) => `color-mix(in srgb, currentColor ${share}%, ${muted})`;
  const gradient = `linear-gradient(${90 - TILT_DEG}deg, ${muted} 0% 46.6%, ${mix(35)} 48%, ${mix(85)} 49.3%, currentColor 49.8% 50.2%, ${mix(85)} 50.7%, ${mix(35)} 52%, ${muted} 53.4% 100%)`;
  return `
[data-${SWEEP_ATTR}] {
  -webkit-text-fill-color: transparent;
  background-image: ${gradient};
  background-size: 300% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: bc-title-sweep ${DURATION}ms linear infinite;
}
@keyframes bc-title-sweep {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-${SWEEP_ATTR}] { animation: none; background: none; -webkit-text-fill-color: ${muted}; }
}
`;
}

let mounted = 0;

function useSweepRules(muted: string, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let style = document.getElementById(STYLE_ELEMENT_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ELEMENT_ID;
      document.head.appendChild(style);
    }
    style.textContent = sweepRules(muted);
  }, [muted, on]);

  useEffect(() => {
    if (!on) return;
    mounted += 1;
    return () => {
      mounted -= 1;
      if (mounted === 0) document.getElementById(STYLE_ELEMENT_ID)?.remove();
    };
  }, [on]);
}

function WebSweep(props: SweepProps) {
  useSweepRules(props.mutedColor, props.active);
  return (
    <View {...containerProps(props)}>
      <TaskText numberOfLines={props.titleLines ?? 2} ellipsizeMode="tail" testID="task-card-title"
        {...(props.active ? { dataSet: { [SWEEP_ATTR]: "" } } : null)}
        style={[props.style, { color: props.active ? props.highlightColor : props.mutedColor }]}>{props.title}</TaskText>
    </View>
  );
}

const BAND_WIDTH = 60;
const SLICES = 16;
const SLICE_WIDTH = BAND_WIDTH / SLICES;
const INTENSITIES = Array.from({ length: SLICES }, (_, index) => Math.sin(Math.PI * (index + 0.5) / SLICES) ** 2);
const LEAN = Math.tan(TILT_DEG * Math.PI / 180);
/**
 * The band shears its slices from its top edge; each copy shears back from
 * the same edge, so the glyphs stay upright and aligned while the slices'
 * edges lean.
 */
const SHEAR = { transformOrigin: "left top", skew: [{ skewX: `${TILT_DEG}deg` }] } as const;
const UNSHEAR = [{ skewX: `${-TILT_DEG}deg` }] as const;

function NativeSweep(props: SweepProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const { active } = props;
  useEffect(() => {
    progress.setValue(0);
    if (!active || width === 0) return;
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: DURATION, easing: (value) => value, useNativeDriver: true, isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [active, progress, width]);
  // A short rest past the right edge before the next pass, as on web. The
  // band's foot leads its top by the lean, so it starts that much further left.
  const start = -BAND_WIDTH - LEAN * height;
  const travel = { inputRange: [0, 0.8, 1], outputRange: [start, width, width] };
  const counterTravel = { inputRange: travel.inputRange, outputRange: [-start, -width, -width] };
  return (
    <View {...containerProps(props)} onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
      <TaskText numberOfLines={props.titleLines ?? 2} ellipsizeMode="tail" style={[props.style, { color: props.mutedColor }]} testID="task-card-title">{props.title}</TaskText>
      {active && width > 0 ? (
        <Animated.View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="task-title-update-sheen"
          style={{ position: "absolute", top: 0, bottom: 0, width: BAND_WIDTH, overflow: "hidden", transformOrigin: SHEAR.transformOrigin, transform: [{ translateX: progress.interpolate(travel) }, ...SHEAR.skew] }}>
          {INTENSITIES.map((opacity, index) => (
            <View key={index} style={{ position: "absolute", top: 0, bottom: 0, left: index * SLICE_WIDTH, width: SLICE_WIDTH, overflow: "hidden" }}>
              {/* Counter-motion keeps every clipped copy aligned with the in-flow title. */}
              <Animated.View style={{ width, marginLeft: -index * SLICE_WIDTH, opacity, transformOrigin: SHEAR.transformOrigin, transform: [{ translateX: progress.interpolate(counterTravel) }, ...UNSHEAR] }}>
                <TaskText numberOfLines={props.titleLines ?? 2} ellipsizeMode="tail" style={[props.style, { color: props.highlightColor }]}>{props.title}</TaskText>
              </Animated.View>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

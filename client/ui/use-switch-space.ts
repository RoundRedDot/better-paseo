import { useRef, type KeyboardEvent } from "react";
import { Platform } from "react-native";

function plainSpace(event: KeyboardEvent<HTMLElement>): boolean {
  return (event.key === " " || event.key === "Spacebar") && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing;
}

/** RNW handles Enter, but only button roles get Space. Match its keyup activation. */
export function useSwitchSpace(onPress: () => void) {
  const armed = useRef(false);
  if (Platform.OS !== "web") return {};
  return {
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (!plainSpace(event) || event.target !== event.currentTarget) {
        armed.current = false;
        return;
      }
      event.preventDefault();
      if (!event.repeat) armed.current = true;
    },
    onKeyUp(event: KeyboardEvent<HTMLElement>) {
      const activate = armed.current && plainSpace(event) && event.target === event.currentTarget;
      armed.current = false;
      if (activate) {
        event.preventDefault();
        onPress();
      }
    },
    onBlur() { armed.current = false; },
  };
}

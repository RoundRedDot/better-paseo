import { View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";

export function QuestionSelectionMark({ multiSelect, selected, size, accent, accentForeground, muted }: {
  multiSelect: boolean; selected: boolean; size: number; accent: string; accentForeground: string; muted: string;
}) {
  if (multiSelect || !selected) return <Icon name={multiSelect ? selected ? "SquareCheck" : "Square" : "Circle"} size={size} color={selected ? accent : muted} />;
  return <View testID="question-selected-mark" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: accent, alignItems: "center", justifyContent: "center" }}>
    <Icon name="Check" size={Math.round(size * 0.7)} color={accentForeground} />
  </View>;
}

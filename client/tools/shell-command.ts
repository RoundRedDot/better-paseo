/**
 * Split a shell row's operator chain, preserving the original text of each
 * command. Quoted or escaped operators are arguments, not chain separators.
 * Newlines keep their existing first-line summary (including heredoc bodies).
 * A pipeline counts as one command; icon lookup can inspect its stages.
 * This reads display text; it does not parse or execute a shell script.
 */
export function splitShellCommands(command: string, splitPipelines = false): string[] {
  const segments: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (char === "\\" && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "\n") break;
    if (char === "#" && (index === 0 || /\s/.test(command[index - 1]!))) {
      break;
    }
    const pair = command.slice(index, index + 2);
    if (pair !== "&&" && pair !== "||" && char !== ";" &&
      (!splitPipelines || char !== "|" || command[index - 1] === ">")) continue;
    const segment = command.slice(start, index).trim();
    if (segment) segments.push(segment);
    if (pair === "&&" || pair === "||" || pair === "|&") index += 1;
    start = index + 1;
  }
  const tail = command.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
}

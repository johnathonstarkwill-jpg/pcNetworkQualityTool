import type { ControlMessage } from "../shared/types.js";

export const CONTROL_PORT = 48200;

export function encode(message: ControlMessage): string {
  return `${JSON.stringify(message)}\n`;
}

// Returns a stateful decoder. Feed it raw socket chunks (strings); it returns
// the complete ControlMessages parsed so far, buffering any partial trailing
// line and silently discarding malformed lines.
export function createDecoder(): (chunk: string) => ControlMessage[] {
  let buffer = "";

  return (chunk: string): ControlMessage[] => {
    buffer += chunk;
    const messages: ControlMessage[] = [];
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim().length > 0) {
        try {
          messages.push(JSON.parse(line) as ControlMessage);
        } catch {
          // Drop malformed frame; a real logger would record it here.
        }
      }

      newlineIndex = buffer.indexOf("\n");
    }

    return messages;
  };
}

import { DeliveryError } from "./errors.js";

/** Reads one secret line for an owner-run command. At a terminal it prompts
 * on stderr with echo off; otherwise it reads piped standard input. The value
 * never comes from arguments, environment variables or files. */
export interface SecretInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: "utf8"): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "end" | "error", listener: (error?: Error) => void): unknown;
  removeAllListeners(): unknown;
  pause(): unknown;
  resume(): unknown;
  /** Lets the process exit with the stream still open (a terminal). */
  unref?(): unknown;
}
export const secretInputLimit = 4096;

export function readSecret(
  prompt: string,
  input: SecretInput = process.stdin as unknown as SecretInput,
  output: { write(text: string): unknown } = process.stderr,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tty = input.isTTY === true && typeof input.setRawMode === "function";
    let value = "";
    const finish = (error?: Error) => {
      input.removeAllListeners();
      if (tty) {
        input.setRawMode!(false);
        output.write("\n");
      }
      input.pause();
      // A paused terminal stream still holds the event loop open, so the
      // command would hang after printing its result.
      input.unref?.();
      if (error) reject(error);
      else if (!value.trim())
        reject(new DeliveryError("No secret was entered; nothing was stored."));
      else resolve(value.trim());
    };
    input.setEncoding("utf8");
    if (tty) {
      output.write(prompt);
      input.setRawMode!(true);
    }
    input.on("data", (chunk: string) => {
      for (const character of chunk) {
        if (tty && character === "\u0003")
          return finish(new DeliveryError("Cancelled; nothing was stored."));
        if (tty && (character === "\r" || character === "\n")) return finish();
        if (tty && (character === "\u007f" || character === "\b")) {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
        if (value.length > secretInputLimit)
          return finish(
            new DeliveryError("The secret is too long; nothing was stored."),
          );
      }
    });
    input.on("end", () => finish());
    input.on("error", (error) =>
      finish(
        new DeliveryError("Reading the secret failed; nothing was stored."),
      ),
    );
    input.resume();
  });
}

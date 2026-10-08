import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type {
  SubscriptionObservation,
  SubscriptionReader,
} from "./subscription.js";

/** Explicit host-owned executable. No shell, inference, login, billing or reset calls. */
export function codexSubscriptionReader(
  executable: string,
): SubscriptionReader {
  return () =>
    new Promise((resolve) => {
      if (!isAbsolute(executable)) {
        resolve(undefined);
        return;
      }
      const child = spawn(executable, ["app-server"], {
        cwd:
          process.platform === "win32"
            ? (process.env.SystemRoot ?? "C:\\Windows")
            : "/",
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        shell: false,
      });
      let buffer = "",
        total = 0,
        account: any,
        limits: any,
        finished = false;
      const finish = (value?: SubscriptionObservation) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.kill();
        resolve(value);
      };
      const timer = setTimeout(() => finish(), 4000);
      const send = (message: object) =>
        child.stdin.write(JSON.stringify(message) + "\n");
      child.on("error", () => finish());
      child.stdin.on("error", () => finish());
      child.on("exit", () => finish());
      child.stdout.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 256 * 1024) {
          finish();
          return;
        }
        buffer += chunk.toString("utf8");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.error && [1, 2, 3].includes(message.id)) {
              finish();
              return;
            }
            if (message.id === 1) {
              send({ method: "initialized" });
              send({
                method: "account/read",
                id: 2,
                params: { refreshToken: false },
              });
              send({ method: "account/rateLimits/read", id: 3 });
            }
            if (message.id === 2) account = message.result?.account;
            if (message.id === 3) limits = message.result;
            if (account && limits) {
              if (
                account.type !== "chatgpt" ||
                typeof account.email !== "string"
              ) {
                finish();
                return;
              }
              const buckets =
                limits.rateLimitsByLimitId !== undefined &&
                limits.rateLimitsByLimitId !== null
                  ? Object.values(limits.rateLimitsByLimitId)
                  : [limits.rateLimits];
              const windows: SubscriptionObservation["windows"] = [];
              let exhausted = false;
              for (const raw of buckets) {
                const bucket = raw as any;
                if (!bucket || typeof bucket.limitId !== "string")
                  throw Error();
                exhausted ||= Boolean(bucket.rateLimitReachedType);
                for (const key of ["primary", "secondary"] as const) {
                  const window = bucket[key];
                  if (window != null)
                    windows.push({
                      id: bucket.limitId + ":" + key,
                      usedPercent: window.usedPercent,
                      resetsAt: window.resetsAt,
                    });
                }
              }
              finish({
                observedAt: new Date().toISOString(),
                authMode: "chatgpt",
                accountId: createHash("sha256")
                  .update(account.email)
                  .digest("hex"),
                windows,
                exhausted,
              });
            }
          } catch {
            finish();
            return;
          }
        }
      });
      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "developer_os_usage", version: "0.1.0" },
          capabilities: {},
        },
      });
    });
}

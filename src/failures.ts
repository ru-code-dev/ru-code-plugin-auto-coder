import { pluginFailureData, rpcFailure } from "@smart-tools/plugin-sdk/host";

import type { AutoCoderRunStatus } from "./contracts.ts";

export type AutoCoderFailure =
  | { readonly kind: "unknown-project"; readonly projectId: string }
  | { readonly kind: "script-missing"; readonly path: string }
  | { readonly kind: "already-running"; readonly status: AutoCoderRunStatus }
  | { readonly kind: "not-running" }
  | { readonly kind: "write-failed"; readonly file: string; readonly detail: string }
  | { readonly kind: "transport" }
  | { readonly kind: "unavailable"; readonly detail: string };

export const autoCoderFailure = (data: AutoCoderFailure, message: string): Error =>
  rpcFailure(data, message);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const decodeAutoCoderFailure = (error: unknown): AutoCoderFailure => {
  const record = asRecord(error);
  if (record !== null) {
    const payload = pluginFailureData(error) as Record<string, unknown> | null;
    const kind = payload === null ? undefined : payload["kind"];
    if (kind === "unknown-project") {
      return { kind, projectId: asString(payload?.["projectId"]) };
    }
    if (kind === "script-missing") return { kind, path: asString(payload?.["path"]) };
    if (kind === "already-running") {
      return { kind, status: payload?.["status"] as AutoCoderRunStatus };
    }
    if (kind === "not-running") return { kind };
    if (kind === "write-failed") {
      return {
        kind,
        file: asString(payload?.["file"]),
        detail: asString(payload?.["detail"]),
      };
    }
    const reason = record["reason"];
    if (reason === "transport") return { kind: "transport" };
    if (typeof reason === "string") {
      return { kind: "unavailable", detail: asString(record["detail"]) || reason };
    }
  }
  return { kind: "unavailable", detail: error instanceof Error ? error.message : String(error) };
};

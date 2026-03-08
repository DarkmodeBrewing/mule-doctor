import type { DiagnosticTargetRef } from "../types/contracts.js";

export function describeDiagnosticTarget(target: DiagnosticTargetRef | undefined): string {
  if (!target || target.kind === "external") {
    return "external configured rust-mule client";
  }
  return `managed instance ${target.instanceId}`;
}

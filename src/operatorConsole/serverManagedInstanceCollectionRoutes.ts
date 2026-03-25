import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./http.js";
import { handleManagedInstanceErrors } from "./serverUtils.js";
import type { ManagedInstanceRouteContext } from "./serverManagedInstanceRouteContext.js";
import { pastTenseVerb } from "./serverManagedInstanceRouteContext.js";

export async function handleInstancesCollection(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstances) {
    sendJson(res, 501, { ok: false, error: "managed instance control unavailable" });
    return;
  }
  if (req.method === "GET") {
    const instances = await ctx.managedInstances.listInstances();
    sendJson(res, 200, { ok: true, instances });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const id = typeof payload.id === "string" ? payload.id : "";
  const apiPort =
    typeof payload.apiPort === "number" && Number.isInteger(payload.apiPort)
      ? payload.apiPort
      : undefined;
  const created = await handleManagedInstanceErrors(() =>
    ctx.managedInstances!.createPlannedInstance({ id, apiPort }),
  );
  await ctx.appendManagedInstanceControlEvent(
    created,
    `Operator created planned managed instance ${created.id}.`,
  );
  sendJson(res, 201, { ok: true, instance: created });
}

export async function handleInstancePresets(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  sendJson(res, 200, { ok: true, presets: ctx.managedInstancePresets.listPresets() });
}

export async function handleApplyInstancePreset(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const applied = await handleManagedInstanceErrors(() =>
    ctx.managedInstancePresets!.applyPreset({
      presetId: typeof payload.presetId === "string" ? payload.presetId : "",
      prefix: typeof payload.prefix === "string" ? payload.prefix : "",
    }),
  );
  await ctx.appendManagedInstanceControlEvents(
    applied.instances,
    (instance) =>
      `Operator applied preset ${applied.presetId} and created planned managed instance ${instance.id}.`,
  );
  sendJson(res, 201, { ok: true, applied });
}

export async function handleInstancePresetAction(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  if (!ctx.managedInstancePresets) {
    sendJson(res, 501, { ok: false, error: "managed instance presets unavailable" });
    return;
  }
  const suffix = path.slice("/api/instance-presets/".length);
  const [prefixRaw, action] = suffix.split("/");
  let prefix = "";
  try {
    prefix = decodeURIComponent(prefixRaw ?? "").trim();
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid percent-encoding in preset group prefix" });
    return;
  }
  if (!prefix) {
    sendJson(res, 400, { ok: false, error: "missing preset group prefix" });
    return;
  }
  if (action !== "start" && action !== "stop" && action !== "restart") {
    sendJson(res, 404, { ok: false, error: "preset action not found" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const lifecycleAction = action;
  const actionVerb = pastTenseVerb(lifecycleAction);
  const result = await handleManagedInstanceErrors(() => {
    if (action === "start") {
      return ctx.managedInstancePresets!.startPreset(prefix);
    }
    if (action === "stop") {
      return ctx.managedInstancePresets!.stopPreset(prefix);
    }
    return ctx.managedInstancePresets!.restartPreset(prefix);
  });
  await ctx.appendManagedInstanceControlEvents(
    result.instances,
    (instance) => `Operator ${actionVerb} managed instance ${instance.id} from preset group ${prefix}.`,
  );
  if (action === "start") {
    sendJson(res, 200, { ok: true, result, started: result });
    return;
  }
  sendJson(res, 200, { ok: true, result });
}

export async function handleDiscoverabilityCheck(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.managedInstanceDiscoverability) {
    sendJson(res, 501, { ok: false, error: "managed discoverability checks unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const result = await handleManagedInstanceErrors(() =>
    ctx.managedInstanceDiscoverability!.runControlledCheck({
      publisherInstanceId: typeof payload.publisherInstanceId === "string" ? payload.publisherInstanceId : "",
      searcherInstanceId: typeof payload.searcherInstanceId === "string" ? payload.searcherInstanceId : "",
      fixtureId: typeof payload.fixtureId === "string" ? payload.fixtureId : undefined,
      timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
      pollIntervalMs: typeof payload.pollIntervalMs === "number" ? payload.pollIntervalMs : undefined,
    }),
  );
  await ctx.appendOperatorEvent({
    type: "managed_instance_control_applied",
    message:
      `Operator ran controlled discoverability check from ${result.publisherInstanceId} to ${result.searcherInstanceId} ` +
      `with outcome ${result.outcome}.`,
    target: {
      kind: "managed_instance",
      instanceId: result.searcherInstanceId,
    },
    actor: "operator_console",
  });
  if (ctx.discoverabilityResults) {
    await ctx.discoverabilityResults.append(result);
  }
  if (ctx.searchHealthResults) {
    await ctx.searchHealthResults.appendControlledDiscoverability(result);
  }
  sendJson(res, 200, { ok: true, result });
}

export async function handleOperatorSearchLaunch(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!ctx.operatorSearches) {
    sendJson(res, 501, { ok: false, error: "manual keyword search unavailable" });
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  const payload = await readJsonBody(req);
  const mode = typeof payload.mode === "string" ? payload.mode : undefined;
  if (mode !== "active_target" && mode !== "managed_instance") {
    sendJson(res, 400, { ok: false, error: "invalid mode: expected 'active_target' or 'managed_instance'" });
    return;
  }
  const query = typeof payload.query === "string" && payload.query.trim().length > 0 ? payload.query : undefined;
  const keywordIdHex =
    typeof payload.keywordIdHex === "string" && payload.keywordIdHex.trim().length > 0
      ? payload.keywordIdHex
      : undefined;
  if (!query && !keywordIdHex) {
    sendJson(res, 400, {
      ok: false,
      error: "manual search requires a non-empty 'query' or 'keywordIdHex'",
    });
    return;
  }
  if (query && keywordIdHex) {
    sendJson(res, 400, {
      ok: false,
      error: "manual search requires either 'query' or 'keywordIdHex', not both",
    });
    return;
  }
  const result = await handleManagedInstanceErrors(() =>
    ctx.operatorSearches!.startSearch({
      mode,
      instanceId: typeof payload.instanceId === "string" ? payload.instanceId : undefined,
      query,
      keywordIdHex,
    }),
  );
  await ctx.appendOperatorEvent({
    type: "managed_instance_control_applied",
    message: `Operator launched manual keyword search against ${result.targetLabel} (${result.searchId}).`,
    target: result.target,
    actor: "operator_console",
  });
  sendJson(res, 200, { ok: true, result });
}

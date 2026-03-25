import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApplyInstancePreset, handleDiscoverabilityCheck, handleInstancePresetAction, handleInstancePresets, handleInstancesCollection, handleOperatorSearchLaunch } from "./serverManagedInstanceCollectionRoutes.js";
import { handleInstanceAction } from "./serverManagedInstanceItemRoutes.js";
import type { ManagedInstanceRouteContext } from "./serverManagedInstanceRouteContext.js";

export async function handleManagedInstanceApiRoute(
  ctx: ManagedInstanceRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (path === "/api/instances") {
    await handleInstancesCollection(ctx, req, res);
    return true;
  }
  if (path === "/api/instance-presets") {
    await handleInstancePresets(ctx, req, res);
    return true;
  }
  if (path === "/api/instance-presets/apply") {
    await handleApplyInstancePreset(ctx, req, res);
    return true;
  }
  if (path.startsWith("/api/instance-presets/")) {
    await handleInstancePresetAction(ctx, req, res, path);
    return true;
  }
  if (path === "/api/discoverability/check") {
    await handleDiscoverabilityCheck(ctx, req, res);
    return true;
  }
  if (path === "/api/searches/launch") {
    await handleOperatorSearchLaunch(ctx, req, res);
    return true;
  }
  if (path.startsWith("/api/instances/")) {
    await handleInstanceAction(ctx, req, res, path);
    return true;
  }
  return false;
}

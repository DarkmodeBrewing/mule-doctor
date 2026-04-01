import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGeneralControlRoute } from "./serverGeneralControlRoutes.js";
import type { GeneralRouteContext } from "./serverGeneralRouteContext.js";
import { handleGeneralReadRoute } from "./serverGeneralReadRoutes.js";

export type { GeneralRouteContext } from "./serverGeneralRouteContext.js";

export async function handleGeneralApiRoute(
  ctx: GeneralRouteContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  path: string,
): Promise<boolean> {
  if (await handleGeneralControlRoute(ctx, req, res, url, path)) {
    return true;
  }
  if (req.method !== "GET") {
    return false;
  }
  return handleGeneralReadRoute(ctx, url, path, res);
}

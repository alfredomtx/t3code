import { PERSONAL_DESKTOP } from "@t3tools/shared/personalDesktop";
import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

export const DESKTOP_RENDERER_ORIGINS = [
  `${PERSONAL_DESKTOP.scheme}://app`,
  `${PERSONAL_DESKTOP.developmentScheme}://app`,
] as const;

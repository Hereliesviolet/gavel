import { telemetryRequestPath } from "./lib/safe-url";

export async function register() {}

export async function onRequestError(error: unknown, request: { path: string; method: string }) {
  const { captureException } = await import("./lib/sentry");
  await captureException(error, {
    path: telemetryRequestPath(request.path),
    method: request.method,
  });
}

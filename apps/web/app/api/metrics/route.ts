import { NextRequest, NextResponse } from "next/server";
import { rejectIfCronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = rejectIfCronUnauthorized(req, "metrics");
  if (denied) return denied;

  const body = [
    "# HELP gavel_web_up Next.js erreichbar",
    "# TYPE gavel_web_up gauge",
    "gavel_web_up 1",
    "",
  ].join("\n");
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}

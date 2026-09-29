"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { confirmPendingEmailChange } from "@/lib/email-change-apply";
import {
  EMAIL_CONFIRM_COOKIE,
  EMAIL_CONFIRM_QUERY,
  MAX_EMAIL_CONFIRM_TOKEN,
  emailConfirmCookieOptions,
} from "@/lib/email-change";
import { isTrustedMutationOrigin } from "@/lib/request-meta";
import { isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

const CONFIRM_RATE = { max: 10, windowSeconds: 10 * 60, failClosed: true };

export async function confirmEmailAction() {
  const incoming = await headers();
  if (
    !isTrustedMutationOrigin(incoming.get("origin"), incoming.get("referer"), incoming.get("host"))
  ) {
    redirect(`/login?email=${EMAIL_CONFIRM_QUERY.invalid}`);
  }

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/login/confirm-email");
  }

  const rateKey = `email-confirm:${session.user.id}`;
  if (await isRateLimited(rateKey, CONFIRM_RATE)) {
    redirect(`/login?email=${EMAIL_CONFIRM_QUERY.throttled}`);
  }

  const jar = await cookies();
  const token = (jar.get(EMAIL_CONFIRM_COOKIE)?.value ?? "")
    .trim()
    .slice(0, MAX_EMAIL_CONFIRM_TOKEN);
  const request = new Request("https://gavel.local/login/confirm-email", {
    headers: incoming,
  });
  const result = await confirmPendingEmailChange(token, request, session.user.id);
  if (result.ok) {
    jar.set(EMAIL_CONFIRM_COOKIE, "", { ...emailConfirmCookieOptions(), maxAge: 0 });
    redirect(`/login?email=${EMAIL_CONFIRM_QUERY.confirmed}`);
  }
  await recordRateLimitHit(rateKey, CONFIRM_RATE);
  redirect(`/login?email=${result.reason}`);
}

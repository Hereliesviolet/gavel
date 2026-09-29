export function readAuthSecret(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string | null {
  const secret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim();
  return secret || null;
}

export function requireAuthSecret(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  const secret = readAuthSecret(env);
  if (!secret) {
    throw new Error("AUTH_SECRET/NEXTAUTH_SECRET fehlt");
  }
  return secret;
}

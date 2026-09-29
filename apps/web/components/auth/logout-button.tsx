"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export function LogoutButton(props: Omit<ButtonProps, "onClick">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/auth/logout", { method: "POST" });
        if (!r.ok) throw new Error("Logout fehlgeschlagen");
        router.replace("/login");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Logout fehlgeschlagen");
      }
    });
  }

  return (
    <>
      <Button variant="outline" onClick={onClick} disabled={pending} {...props}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        Abmelden
      </Button>
      {error && <p className="text-[11px] text-destructive font-mono mt-1">{error}</p>}
    </>
  );
}

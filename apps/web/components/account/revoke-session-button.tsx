"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function onClick() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/account/sessions/${sessionId}`, {
          method: "DELETE",
        });
        const data = await res.json();

        if (!res.ok) {
          toast.error(data?.error ?? "Sitzung konnte nicht widerrufen werden.");
          return;
        }

        setDone(true);
        toast.success("Sitzung widerrufen.");
        router.refresh();
      } catch {
        toast.error("Netzwerkfehler beim Widerrufen.");
      }
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-10 px-3.5 sm:h-7 sm:px-2.5 shrink-0"
            disabled={pending || done}
          />
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
        Widerrufen
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sitzung widerrufen?</AlertDialogTitle>
          <AlertDialogDescription>
            Das Gerät wird sofort abgemeldet und muss sich erneut einloggen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={onClick}>Widerrufen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
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

export function DeleteAnalyseButton({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/analyse/${listingId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error ?? "Analyse konnte nicht gelöscht werden.");
        setDeleting(false);
        return;
      }
      router.push("/analyse");
    } catch {
      toast.error("Netzwerkfehler beim Löschen.");
      setDeleting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            disabled={deleting}
          />
        }
      >
        {deleting ? (
          <Loader2 className="size-4 mr-1.5 animate-spin" />
        ) : (
          <Trash2 className="size-4 mr-1.5" />
        )}
        Analyse löschen
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Analyse löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Die Analyse verschwindet aus deinem Verlauf. Geteilte öffentliche Live-Scrapes anderer
            Nutzer bleiben erhalten. Nur wenn niemand sonst sie nutzt, werden Bilder und Auswertung
            gelöscht.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete}>Löschen</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

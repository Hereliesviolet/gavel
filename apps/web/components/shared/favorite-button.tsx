"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAdjustFavoritesCount } from "@/hooks/use-favorites-count";

interface FavoriteButtonProps {
  listingId: string;
  listingType?: "zvg" | "real_estate";
  initialFavorited?: boolean;
  className?: string;
  onFavoritedChange?: (favorited: boolean) => void;
}

export function FavoriteButton({
  listingId,
  listingType = "zvg",
  initialFavorited = false,
  className,
  onFavoritedChange,
}: FavoriteButtonProps) {
  const router = useRouter();
  const identity = `${listingType}:${listingId}`;
  const [favorited, setFavorited] = useState(initialFavorited);
  const [seenIdentity, setSeenIdentity] = useState(identity);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const identityRef = useRef(identity);
  const adjustFavoritesCount = useAdjustFavoritesCount();
  identityRef.current = identity;

  if (seenIdentity !== identity) {
    setSeenIdentity(identity);
    setFavorited(initialFavorited);
    setPending(false);
  }

  useEffect(() => {
    setFavorited(initialFavorited);
  }, [identity, initialFavorited]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const requestIdentity = identity;
    const newState = !favorited;
    setFavorited(newState);
    setPending(true);
    adjustFavoritesCount(newState ? 1 : -1);

    startTransition(async () => {
      const revert = () => {
        adjustFavoritesCount(newState ? -1 : 1);
        if (identityRef.current === requestIdentity) {
          setFavorited(!newState);
        }
      };
      try {
        const res = await fetch(`/api/favorites/${listingId}`, {
          method: newState ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingType }),
        });

        if (res.status === 401) {
          revert();
          router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
          return;
        }

        if (!res.ok) {
          revert();
          return;
        }
        onFavoritedChange?.(newState);
      } catch {
        revert();
      } finally {
        if (identityRef.current === requestIdentity) {
          setPending(false);
        }
      }
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      disabled={pending}
      aria-label={favorited ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
      className={cn(
        // size-8 (32px) aus size="icon" liegt unter der WCAG-Empfehlung von
        // 44px Touch-Zielfläche - hier gezielt vergrößert (nur diese Instanz),
        // konsistent mit den 44px-Icon-Buttons in der Navbar.
        "size-11 rounded-full bg-background/80 backdrop-blur-sm hover:bg-background",
        className,
      )}
    >
      {favorited ? (
        <Check className="transition-all duration-150 text-primary scale-110" />
      ) : (
        <Plus className="transition-all duration-150 text-muted-foreground hover:text-primary" />
      )}
    </Button>
  );
}

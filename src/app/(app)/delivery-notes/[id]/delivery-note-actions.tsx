"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";

export function DeliveryNoteActions({
  noteId,
  status,
  canWrite,
}: {
  noteId: string;
  status: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!canWrite || status !== "DRAFT") return null;

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await fetch(`/api/delivery-notes/${noteId}/issue`, {
            method: "POST",
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data.error || "Αποτυχία έκδοσης");
            return;
          }
          toast.success("Το δελτίο εκδόθηκε");
          router.refresh();
        });
      }}
    >
      Έκδοση
    </Button>
  );
}

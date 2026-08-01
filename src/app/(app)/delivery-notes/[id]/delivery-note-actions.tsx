"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { TransformActionButton } from "@/modules/document-transforms/transform-dialog";

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

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {status !== "CANCELLED" ? (
        <TransformActionButton
          sourceKind="DELIVERY_NOTE"
          sourceId={noteId}
          canWrite={canWrite}
        />
      ) : null}
      {canWrite && status === "DRAFT" ? (
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
      ) : null}
    </div>
  );
}

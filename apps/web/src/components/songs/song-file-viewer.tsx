import { ExternalLink, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";

import { FilePdfReader } from "@/components/schedule/file-pdf-reader";
import { paneBarClassName } from "@/components/schedule/plan-file-pane-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverLabel } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { useSongAttachmentPdf } from "@/hooks/use-song-attachments";
import type { SongAttachment } from "@/hooks/use-song-attachments";

const ViewerMessage = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>{children}</EmptyContent>
  </Empty>
);

const SongPdf = ({
  songId,
  arrangementId,
  attachment,
  name,
  onOpenOriginal,
}: {
  songId: string;
  arrangementId: string;
  attachment: SongAttachment;
  name: string;
  onOpenOriginal: () => void;
}) => {
  const pdf = useSongAttachmentPdf(songId, arrangementId, attachment);
  let body: ReactNode = (
    <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
      <Spinner /> Loading file…
    </div>
  );
  if (pdf.isError) {
    body = (
      <ViewerMessage
        title="Couldn’t open this file"
        description="It may be unavailable, or you may not have access to it."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void pdf.refetch();
            }}
          >
            <RefreshCw /> Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenOriginal}>
            Get the original instead
          </Button>
        </div>
      </ViewerMessage>
    );
  } else if (pdf.data?.data !== undefined) {
    body = <FilePdfReader data={pdf.data.data} />;
  } else if (pdf.data !== undefined) {
    body = (
      <ViewerMessage
        title="No preview for this file"
        description="It opens in its original viewer."
      >
        <Button size="sm" onClick={onOpenOriginal}>
          <ExternalLink /> Open original
        </Button>
      </ViewerMessage>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={paneBarClassName({ atTop: true })}>
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <h3
          aria-hidden
          className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
        >
          {name}
        </h3>
        <HoverLabel
          label="Open original"
          side="bottom"
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open original"
              onClick={onOpenOriginal}
            />
          }
        >
          <ExternalLink />
        </HoverLabel>
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" />}
          aria-label="Close"
        >
          <X />
        </DialogClose>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
};

/**
 * A stored PDF from the song's files, shown in the app. Planning Center's signed links make the
 * browser download PDFs, so the reader renders the bytes the API fetched instead.
 */
export const SongFileViewer = ({
  songId,
  arrangementId,
  attachment,
  name,
  onOpenOriginal,
  onClose,
}: {
  songId: string;
  arrangementId: string;
  attachment: SongAttachment | null;
  name: string;
  onOpenOriginal: (attachment: SongAttachment) => void;
  onClose: () => void;
}) => (
  <Dialog
    open={attachment !== null}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
  >
    <DialogContent variant="viewer" showCloseButton={false}>
      {attachment === null ? null : (
        <SongPdf
          key={`${attachment.keyId ?? ""}:${attachment.id}`}
          songId={songId}
          arrangementId={arrangementId}
          attachment={attachment}
          name={name}
          onOpenOriginal={() => {
            onOpenOriginal(attachment);
          }}
        />
      )}
    </DialogContent>
  </Dialog>
);

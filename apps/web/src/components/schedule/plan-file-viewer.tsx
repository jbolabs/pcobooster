import type {
  PlanFile,
  PlanFileLink,
  PlanFileOpenMode,
} from "@pcobooster/contracts/http/plan-files";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { FilePdfReader } from "@/components/schedule/file-pdf-reader";
import { LoopingAudioPlayer } from "@/components/schedule/looping-audio-player";
import { PlanFileIconTile } from "@/components/schedule/plan-file-icon";
import { paneBarClassName } from "@/components/schedule/plan-file-pane-bar";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverLabel } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import {
  useOpenPlanFileOriginal,
  usePlanFileLink,
} from "@/hooks/use-plan-files";
import { planFileKind, youtubeEmbedUrl } from "@/lib/plan-files";
import { cn } from "@/lib/utils";

/** The song a viewer dialog is on, which phones show in the file's own bar. */
export interface ViewerHeading {
  readonly title: string;
  /** Arrangement, key, and place in the set; may be empty. */
  readonly subtitle: string;
}

/**
 * Phones only: the dialog's title over the file and the song's details, so one bar holds
 * what desktop splits between the dialog header and the file pane.
 */
export const PhoneHeading = ({
  heading,
  detail,
}: {
  heading: ViewerHeading;
  /** Shown first on the second line, such as the open file's name. */
  detail?: string;
}) => (
  <div aria-hidden className="min-w-0 flex-1 px-1 sm:hidden">
    <p className="truncate text-sm font-semibold">{heading.title}</p>
    <p className="text-muted-foreground truncate text-xs">
      {[detail, heading.subtitle].filter(Boolean).join(" · ")}
    </p>
  </div>
);

const OpenOriginal = ({
  url,
  preview,
  prominent = false,
  onOpen,
}: {
  url: string;
  preview: boolean;
  prominent?: boolean;
  onOpen?: () => Promise<void>;
}) => {
  const label = preview ? "Open preview" : "Open original";
  if (prominent) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "default", size: "sm" })}
      >
        <ExternalLink />
        {label}
      </a>
    );
  }
  return (
    <HoverLabel
      label={label}
      side="bottom"
      trigger={
        <a
          href={url}
          onClick={
            onOpen === undefined
              ? undefined
              : (event) => {
                  event.preventDefault();
                  void onOpen();
                }
          }
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        />
      }
    >
      <ExternalLink />
    </HoverLabel>
  );
};

const PlanFileOriginal = ({
  serviceTypeId,
  planId,
  file,
  link,
}: {
  serviceTypeId: string;
  planId: string;
  file: PlanFile;
  link: PlanFileLink | undefined;
}) => {
  const openOriginal = useOpenPlanFileOriginal(serviceTypeId, planId, file);
  if (link === undefined) {
    return null;
  }
  return (
    <OpenOriginal
      url={link.url}
      preview={link.preview}
      onOpen={link.data === undefined ? undefined : openOriginal}
    />
  );
};

/** A centered message in the reader, for files that can't show here. */
const ReaderMessage = ({
  file,
  title,
  description,
  children,
}: {
  file: PlanFile;
  title: string;
  description: string;
  children?: ReactNode;
}) => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia>
        <PlanFileIconTile file={file} size="lg" />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {children === undefined ? null : <EmptyContent>{children}</EmptyContent>}
  </Empty>
);

const FileContent = ({
  file,
  url,
  data,
  preview,
  canOpen,
  onRetry,
  onFailed,
}: {
  file: PlanFile;
  url: string;
  data: string | undefined;
  preview: boolean;
  canOpen: boolean;
  onRetry: () => Promise<void>;
  onFailed: () => void;
}) => {
  if (data !== undefined) {
    return <FilePdfReader data={data} />;
  }
  const kind = preview ? "image" : planFileKind(file);
  const youtube =
    file.providerType === "AttachmentYoutube" ? youtubeEmbedUrl(url) : null;
  if (youtube !== null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        <iframe
          src={youtube}
          sandbox="allow-scripts allow-presentation"
          title={file.name}
          allow="encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video max-h-full w-full"
        />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <LoopingAudioPlayer
          key={file.id}
          fileId={file.id}
          name={file.name}
          onRetry={onRetry}
          onFailed={onFailed}
          url={url}
        />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
        <video
          key={url}
          aria-label={file.name}
          controls
          playsInline
          controlsList={file.downloadable ? undefined : "nodownload"}
          preload="metadata"
          onError={onFailed}
          className="max-h-full w-full"
          src={url}
        >
          <track kind="captions" />
        </video>
      </div>
    );
  }
  if (kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto overscroll-contain p-4">
        <img
          src={url}
          alt={file.name}
          width={1200}
          height={1600}
          className="h-auto max-w-full rounded-sm shadow-sm"
          onError={onFailed}
        />
      </div>
    );
  }
  return (
    <ReaderMessage
      file={file}
      title="No preview for this file"
      description={
        kind === "document"
          ? "Open it in your device’s document viewer."
          : "It opens in its original viewer."
      }
    >
      {canOpen ? <OpenOriginal url={url} preview={false} prominent /> : null}
    </ReaderMessage>
  );
};

export const PlanFileViewer = ({
  serviceTypeId,
  planId,
  file,
  onBack,
  insetStart = false,
  atTop = true,
  heading,
  trailing,
}: {
  serviceTypeId: string;
  planId: string;
  file: PlanFile;
  /** Back to the list on phones; absent when there is no list. */
  onBack?: () => void;
  /** Leaves room on desktop for the browser's fixed list toggle. */
  insetStart?: boolean;
  /** Whether the toolbar is the top of the screen; false below a dialog header. */
  atTop?: boolean;
  /** The dialog's song, which phones show in this bar in place of the dialog header. */
  heading?: ViewerHeading;
  /** Extra toolbar controls, such as the phone close button. */
  trailing?: ReactNode;
}) => {
  const kind = planFileKind(file);
  const [pdf, setPdf] = useState(kind === "pdf");
  const [mediaFailed, setMediaFailed] = useState(false);
  let mode: PlanFileOpenMode = "link";
  if (pdf) {
    mode = "pdf";
  } else if (file.hasPreview && kind === "document") {
    mode = "preview";
  }
  const link = usePlanFileLink(serviceTypeId, planId, file, mode);
  const canOpen = file.downloadable || kind === "link" || kind === "document";
  const url = link.data?.url ?? "";
  const refresh = () => {
    setMediaFailed(false);
    void link.refetch();
  };

  let body: ReactNode = null;
  if (link.isPending) {
    body = (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Spinner /> Loading file…
      </div>
    );
  } else if (link.isError) {
    body = (
      <ReaderMessage
        file={file}
        title="Couldn’t open this file"
        description="It may be unavailable, or you may not have access to it."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> Try again
          </Button>
          {pdf ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPdf(false);
              }}
            >
              Get the original instead
            </Button>
          ) : null}
        </div>
      </ReaderMessage>
    );
  } else if (url !== "") {
    body = (
      <FileContent
        file={file}
        url={url}
        data={link.data.data}
        preview={link.data.preview}
        canOpen={canOpen}
        onRetry={async () => {
          await link.refetch();
        }}
        onFailed={() => {
          setMediaFailed(true);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={paneBarClassName({ atTop, insetStart })}>
        {onBack ? (
          <Button
            className="sm:hidden"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to files"
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        {heading ? <PhoneHeading heading={heading} detail={file.name} /> : null}
        <h3
          className={cn(
            "min-w-0 flex-1 truncate px-1 text-sm font-medium",
            heading && "max-sm:sr-only"
          )}
        >
          {file.name}
        </h3>
        {canOpen && url !== "" ? (
          <PlanFileOriginal
            serviceTypeId={serviceTypeId}
            planId={planId}
            file={file}
            link={link.data}
          />
        ) : null}
        {trailing}
      </div>
      {mediaFailed ? (
        <div
          role="alert"
          className="bg-muted flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
        >
          This file couldn’t load here. Its link may have expired.
          <Button variant="outline" size="xs" onClick={refresh}>
            <RefreshCw /> Refresh link
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );
};

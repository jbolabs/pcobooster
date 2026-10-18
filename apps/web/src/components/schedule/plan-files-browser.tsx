import type { PlanFile } from "@pcobooster/contracts/http/plan-files";
import type { PlanItem } from "@pcobooster/planning-center-models/types";
import {
  ChevronRight,
  Files,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { PlanFileIcon } from "@/components/schedule/plan-file-icon";
import {
  paneBarClassName,
  PlanFileViewer,
} from "@/components/schedule/plan-file-viewer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HoverLabel } from "@/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Item } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanFiles } from "@/hooks/use-plan-files";
import {
  fileBelongsToItem,
  fileGroupLabel,
  fileSectionLabel,
  groupPlanFiles,
  orderedPlanFiles,
  sectionPlanFiles,
} from "@/lib/plan-files";
import type { PlanFileSection } from "@/lib/plan-files";
import { cn } from "@/lib/utils";

interface Props {
  serviceTypeId: string;
  planId: string;
  items: PlanItem[];
  item?: PlanItem;
}

/** Search only earns its space when there are enough files to hunt through. */
const SEARCH_THRESHOLD = 12;

const CloseButton = ({ className }: { className?: string }) => (
  <DialogClose
    render={<Button variant="ghost" size="icon-sm" className={className} />}
    aria-label="Close"
  >
    <X />
  </DialogClose>
);

/** Desktop only: hides the list so the file fills the dialog. Phones already show one pane. */
const ListToggle = ({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) => {
  const label = open ? "Hide files" : "Show files";
  return (
    <HoverLabel
      label={label}
      side="bottom"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-expanded={open}
          className="absolute top-2 left-3 z-10 max-sm:hidden"
          onClick={onToggle}
        />
      }
    >
      {open ? <PanelLeftClose /> : <PanelLeftOpen />}
    </HoverLabel>
  );
};

const FileRow = ({
  file,
  current,
  onSelect,
}: {
  file: PlanFile;
  current: boolean;
  onSelect: (file: PlanFile) => void;
}) => (
  <li>
    <Item
      size="row"
      variant={current ? "muted" : "default"}
      render={<button type="button" aria-label={file.name} />}
      aria-current={current ? "true" : undefined}
      onClick={() => {
        onSelect(file);
      }}
    >
      <PlanFileIcon
        file={file}
        className="text-muted-foreground size-3.5 shrink-0"
      />
      <span className={cn("truncate", current && "font-medium")}>
        {file.name}
      </span>
    </Item>
  </li>
);

const FileRows = ({
  files,
  shown,
  onSelect,
}: {
  files: PlanFile[];
  shown: PlanFile | null;
  onSelect: (file: PlanFile) => void;
}) => (
  <ul>
    {files.map((file) => (
      <FileRow
        key={file.id}
        file={file}
        current={shown?.id === file.id}
        onSelect={onSelect}
      />
    ))}
  </ul>
);

/** Mix parts can run to dozens per song, so they fold away until wanted. */
const MixParts = ({
  files,
  shown,
  onSelect,
}: {
  files: PlanFile[];
  shown: PlanFile | null;
  onSelect: (file: PlanFile) => void;
}) => (
  <Collapsible
    defaultOpen={files.some((file) => file.id === shown?.id)}
    className="group/mix"
  >
    <CollapsibleTrigger
      render={
        <Item
          size="row"
          render={
            <button
              type="button"
              aria-label={`${fileSectionLabel.mix}, ${String(files.length)} parts`}
            />
          }
        />
      }
    >
      <ChevronRight
        aria-hidden
        className="text-muted-foreground size-3.5 shrink-0 group-data-[open]/mix:rotate-90"
      />
      <span className="flex-1">{fileSectionLabel.mix}</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {files.length}
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent className="ml-3">
      <FileRows files={files} shown={shown} onSelect={onSelect} />
    </CollapsibleContent>
  </Collapsible>
);

/** One song's files. Headings only when they separate more than one section. */
const FileSections = ({
  sections,
  labeled,
  shown,
  onSelect,
}: {
  sections: PlanFileSection[];
  labeled: boolean;
  shown: PlanFile | null;
  onSelect: (file: PlanFile) => void;
}) => (
  <>
    {sections.map(({ section, files }) =>
      section === "mix" ? (
        <MixParts
          key={section}
          files={files}
          shown={shown}
          onSelect={onSelect}
        />
      ) : (
        <section key={section} aria-label={fileSectionLabel[section]}>
          {labeled && sections.length > 1 ? (
            <h3 className="text-muted-foreground px-2 pt-3 pb-1 text-xs">
              {fileSectionLabel[section]}
            </h3>
          ) : null}
          <FileRows files={files} shown={shown} onSelect={onSelect} />
        </section>
      )
    )}
  </>
);

const ListSkeleton = () => (
  <div className="flex flex-col gap-3 px-2 py-2" aria-hidden>
    {["a", "b", "c", "d"].map((key) => (
      <Skeleton key={key} variant="text" className="h-3.5 w-3/4" />
    ))}
  </div>
);

/** Loads every page while the browser is open: the list is only useful whole. */
const useAllPlanFiles = (serviceTypeId: string, planId: string) => {
  const query = usePlanFiles(serviceTypeId, planId);
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  return query;
};

const FileList = ({
  title,
  files,
  items,
  item,
  pending,
  shown,
  onSelect,
}: {
  title: string;
  files: PlanFile[];
  items: PlanItem[];
  item: PlanItem | undefined;
  pending: boolean;
  shown: PlanFile | null;
  onSelect: (file: PlanFile) => void;
}) => {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible =
    needle === ""
      ? files
      : files.filter((file) =>
          `${file.name} ${fileGroupLabel(file, items)}`
            .toLowerCase()
            .includes(needle)
        );
  return (
    <>
      <div className={cn(paneBarClassName, "sm:pl-12")}>
        <h2 className="flex-1 truncate px-1 text-sm font-medium">{title}</h2>
        <CloseButton className="sm:hidden" />
      </div>
      {files.length >= SEARCH_THRESHOLD ? (
        <InputGroup className="mx-3 mb-2 w-auto">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search files"
            placeholder="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </InputGroup>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5">
        {pending ? <ListSkeleton /> : null}
        {item ? (
          <FileSections
            sections={sectionPlanFiles(visible)}
            labeled
            shown={shown}
            onSelect={onSelect}
          />
        ) : (
          groupPlanFiles(visible, items).map((group) => (
            <section key={group.label} aria-label={group.label}>
              <h3 className="text-muted-foreground truncate px-2 pt-3 pb-1 text-xs">
                {group.label}
              </h3>
              <FileSections
                sections={sectionPlanFiles(group.files)}
                labeled={false}
                shown={shown}
                onSelect={onSelect}
              />
            </section>
          ))
        )}
        {needle !== "" && visible.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-sm">No matches</p>
        ) : null}
      </div>
    </>
  );
};

const NoFile = ({
  failed,
  empty,
  onRetry,
}: {
  failed: boolean;
  empty: boolean;
  onRetry: () => void;
}) => (
  <div className="flex flex-1 flex-col">
    <div className="flex justify-end p-2">
      <CloseButton />
    </div>
    <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 text-sm">
      {failed ? (
        <>
          Couldn’t load files.
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </>
      ) : null}
      {empty ? "No files" : null}
    </div>
  </div>
);

const FilesWorkspace = ({ serviceTypeId, planId, items, item }: Props) => {
  const [chosen, setChosen] = useState<PlanFile | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const query = useAllPlanFiles(serviceTypeId, planId);
  const loaded = query.data?.pages.flatMap((page) => page.files) ?? [];
  const files = item
    ? loaded.filter((file) => fileBelongsToItem(file, item))
    : loaded;
  // Desktop opens on the first file; phones start on the list until one is chosen.
  const shown = chosen ?? orderedPlanFiles(files, items)[0] ?? null;
  const showList = files.length > 1 || query.isPending;
  const title = item ? item.title : "Files";
  const back = () => {
    setChosen(null);
  };

  return (
    <div className="relative flex min-h-0 flex-1">
      <DialogTitle className="sr-only">{title}</DialogTitle>
      {showList ? (
        // One toggle outside both panes, so it never moves between open and closed.
        <ListToggle
          open={listOpen}
          onToggle={() => {
            setListOpen((open) => !open);
          }}
        />
      ) : null}
      {showList ? (
        <nav
          aria-label="Files"
          className={cn(
            "pb-safe-3 flex min-h-0 w-full flex-col sm:w-60 sm:shrink-0 sm:border-r",
            chosen !== null && "max-sm:hidden",
            !listOpen && "sm:hidden"
          )}
        >
          <FileList
            title={title}
            files={files}
            items={items}
            item={item}
            pending={query.isPending}
            shown={shown}
            onSelect={setChosen}
          />
        </nav>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col",
          showList && chosen === null && "max-sm:hidden"
        )}
      >
        {shown === null ? (
          <NoFile
            failed={query.isError}
            empty={query.isSuccess}
            onRetry={() => {
              void query.refetch();
            }}
          />
        ) : (
          <PlanFileViewer
            key={shown.id}
            serviceTypeId={serviceTypeId}
            planId={planId}
            file={shown}
            onBack={showList ? back : undefined}
            insetStart={showList && !listOpen}
            trailing={<CloseButton />}
          />
        )}
      </div>
    </div>
  );
};

export const PlanFilesBrowser = (props: Props) => (
  <Dialog>
    {props.item ? (
      <DialogTrigger
        render={<Button variant="outline" size="sm" className="self-start" />}
      >
        <Files /> Files
      </DialogTrigger>
    ) : (
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <span className="text-muted-foreground" aria-hidden>
                <Files className="size-4" />
              </span>
              Files
            </span>
          </CardTitle>
          <CardDescription>Charts, documents, and media</CardDescription>
          <CardAction>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              Browse
            </DialogTrigger>
          </CardAction>
        </CardHeader>
      </Card>
    )}
    <DialogContent variant="viewer" showCloseButton={false}>
      {/* Mounted per open, so each visit starts fresh on the first file. */}
      <FilesWorkspace {...props} />
    </DialogContent>
  </Dialog>
);

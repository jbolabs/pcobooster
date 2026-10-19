import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const statKeys = ["a", "b", "c", "d"];
const rowNameWidths = ["10rem", "8rem", "12rem", "9rem", "7rem", "11rem"];

/** Shared by the account index and user detail while their server data loads. */
export const AdminPageSkeleton = ({ label }: { label: string }) => (
  <main
    className="bg-background min-h-0 flex-1 overflow-auto"
    aria-busy
    aria-label={label}
  >
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-2">
        <Skeleton variant="control" className="h-7 w-40" />
        <Skeleton variant="text" className="h-4 w-80 max-w-full" />
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statKeys.map((key) => (
          <div
            key={key}
            className="border-border/70 bg-card rounded-md border px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton variant="text" className="h-3.5 w-24" />
              <Skeleton variant="text" className="size-4" />
            </div>
            <Skeleton variant="text" className="mt-3 h-6 w-12" />
          </div>
        ))}
      </section>

      <section className="border-border/70 bg-card rounded-md border">
        <div className="flex flex-col gap-2 px-4 py-3">
          <Skeleton variant="text" className="h-3.5 w-24" />
          <Skeleton variant="text" className="h-3 w-64 max-w-full" />
        </div>
        <Separator />
        <div className="divide-border/60 divide-y">
          {rowNameWidths.map((width) => (
            <div key={width} className="flex h-12 items-center gap-6 px-3">
              <Skeleton variant="text" className="h-3.5" width={width} />
              <Skeleton variant="text" className="ml-auto h-3.5 w-10" />
              <Skeleton variant="text" className="hidden h-3.5 w-24 sm:block" />
            </div>
          ))}
        </div>
      </section>
    </div>
  </main>
);

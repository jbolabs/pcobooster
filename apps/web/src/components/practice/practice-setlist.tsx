import type { PlanItem } from "@pcobooster/planning-center-models/types";

import { Item } from "@/components/ui/item";
import { isPracticeStep, practiceSetlist } from "@/lib/practice";
import { cn } from "@/lib/utils";

/** The key a row shows: the plan's starting key for the song. */
const rowKey = (item: PlanItem): string | null => item.key?.startingKey ?? null;

/**
 * The run sheet as a setlist: songs and media are the steps, numbered in order; other items
 * stay listed (quieter) so the service still reads as a whole and can be opened too.
 */
export const PracticeSetlist = ({
  items,
  currentId,
  onSelect,
}: {
  items: readonly PlanItem[];
  currentId: string | null;
  onSelect: (item: PlanItem) => void;
}) => {
  const groups = practiceSetlist(items);
  const numbers = new Map<string, number>();
  for (const item of items) {
    if (isPracticeStep(item)) {
      numbers.set(item.id, numbers.size + 1);
    }
  }
  return (
    <nav aria-label="Setlist" className="flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.header?.id ?? "before-first-header"}
          className="flex flex-col gap-0.5"
        >
          {group.header === null ? null : (
            <h3 className="text-muted-foreground px-2 pb-1 text-xs font-semibold tracking-wide uppercase">
              {group.header.title}
            </h3>
          )}
          {group.items.map((item) => {
            const number = numbers.get(item.id);
            const key = rowKey(item);
            const current = item.id === currentId;
            return (
              <Item
                key={item.id}
                size="row"
                variant={current ? "selected" : "default"}
                aria-current={current ? "true" : undefined}
                className="min-h-9"
                render={
                  <button
                    type="button"
                    aria-label={
                      key === null ? item.title : `${item.title}, key ${key}`
                    }
                    onClick={() => {
                      onSelect(item);
                    }}
                  />
                }
              >
                <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">
                  {number ?? ""}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    number === undefined
                      ? "text-muted-foreground"
                      : "font-medium"
                  )}
                >
                  {item.title}
                </span>
                {key === null ? null : (
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {key}
                  </span>
                )}
              </Item>
            );
          })}
        </section>
      ))}
    </nav>
  );
};

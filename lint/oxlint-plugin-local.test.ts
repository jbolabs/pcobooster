import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import {
  batchGateUsesBatchHasAnsweredRule,
  flushListRowsRule,
  noAbsoluteInputOverlayRule,
  noBackdropBlurRule,
  noClippedSurfaceRule,
  noNudgedIconRule,
  menuLabelInsideGroupRule,
  noOverlaySectionBorderRule,
  noPopoverContentPaddingRule,
  noTransitionColorsRule,
  preferSharedControlsRule,
} from "./oxlint-plugin-local.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      lang: "tsx",
    },
  },
});

// Oxlint's Rule union treats JS-exported create()-only rules as CreateOnceRule
// because meta.type widens to string; assert the create()-based shape for RuleTester.
ruleTester.run(
  "no-absolute-input-overlay",
  noAbsoluteInputOverlayRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "input group search field",
        code: `
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="Filter" />
        </InputGroup>
      `,
      },
      {
        name: "plain input without affixes",
        code: `<Input placeholder="Name" />`,
      },
      {
        name: "relative wrapper without absolute siblings",
        code: `
        <div className="relative">
          <Input placeholder="Name" />
        </div>
      `,
      },
      {
        name: "absolute decoration without bare Input sibling",
        code: `
        <div className="relative">
          <span className="absolute left-3 top-1/2">icon</span>
          <InputGroup>
            <InputGroupInput placeholder="Filter" />
          </InputGroup>
        </div>
      `,
      },
    ],
    invalid: [
      {
        name: "absolute search icon overlaps input",
        code: `
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input placeholder="Filter" />
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
      {
        name: "absolute clear button overlaps input",
        code: `
        <div className="relative">
          <Input value="query" />
          <button
            type="button"
            className="absolute top-1/2 right-1 -translate-y-1/2"
            aria-label="Clear"
          >
            x
          </button>
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
      {
        name: "conditional absolute affix still counted",
        code: `
        <div className="relative">
          <Input placeholder="Filter" />
          {query ? (
            <button
              type="button"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              aria-label="Clear"
            >
              x
            </button>
          ) : null}
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
      {
        name: "native input with absolute icon",
        code: `
        <div className="relative">
          <span className="absolute inset-y-0 left-3 flex items-center">icon</span>
          <input className="w-full" />
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
      {
        name: "textarea with absolute overlay",
        code: `
        <div className="relative">
          <span className="absolute left-3 top-3">icon</span>
          <Textarea placeholder="Notes" />
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
      {
        name: "cn()-built absolute classes",
        code: `
        <div className="relative">
          <Search className={cn("pointer-events-none absolute left-3 top-1/2 size-4", "-translate-y-1/2")} />
          <Input placeholder="Filter" />
        </div>
      `,
        errors: [{ messageId: "overlay" }],
      },
    ],
  }
);

ruleTester.run(
  "no-popover-content-padding",
  noPopoverContentPaddingRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "width-only popover content",
        code: `<PopoverContent className="w-80" />`,
      },
      {
        name: "inner section owns spacing",
        code: `
        <PopoverContent className="w-80">
          <div className="p-3">Body</div>
        </PopoverContent>
      `,
      },
    ],
    invalid: [
      {
        name: "padding on popover shell",
        code: `<PopoverContent className="w-80 p-4" />`,
        errors: [{ messageId: "padding" }],
      },
      {
        name: "gap on popover shell",
        code: `<PopoverContent className="gap-4" />`,
        errors: [{ messageId: "padding" }],
      },
    ],
  }
);

ruleTester.run(
  "no-overlay-section-border-b",
  noOverlaySectionBorderRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "list row divider",
        code: `<div className="border-b px-4 py-3 last:border-b-0" />`,
      },
      {
        name: "separator-based section break",
        code: `
        <PopoverContent>
          <div className="px-3 py-2">Header</div>
          <ItemSeparator className="my-0" />
        </PopoverContent>
      `,
      },
    ],
    invalid: [
      {
        name: "border-b section header in popover",
        code: `<div className="border-b px-3 py-2">Header</div>`,
        errors: [{ messageId: "border" }],
      },
    ],
  }
);

ruleTester.run(
  "no-transition-colors",
  noTransitionColorsRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "layout-only transition",
        code: `<button className="transition-transform duration-200" />`,
      },
      {
        name: "form focus transition",
        code: `<input className="transition-[color,box-shadow,background-color]" />`,
      },
    ],
    invalid: [
      {
        name: "transition-colors on row",
        code: `<button className="hover:bg-muted transition-colors" />`,
        errors: [{ messageId: "transitionColors" }],
      },
      {
        name: "transition-plan-item utility",
        code: `<div className="group/plan-item transition-plan-item duration-200" />`,
        errors: [{ messageId: "transitionColors" }],
      },
      {
        name: "cva variant string",
        code: `
        const rowVariants = cva("hover:bg-muted transition-colors");
      `,
        errors: [{ messageId: "transitionColors" }],
      },
    ],
  }
);

ruleTester.run(
  "no-backdrop-blur",
  noBackdropBlurRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "solid semantic background",
        code: `<header className="bg-background sticky top-0" />`,
      },
      {
        name: "dimmed overlay without blur",
        code: `<div className="fixed inset-0 bg-black/30" />`,
      },
      {
        name: "content blur filter",
        code: `<img className="blur-sm" alt="" />`,
      },
      {
        name: "unrelated class containing the word",
        code: `<div className="my-backdrop-blurb" />`,
      },
    ],
    invalid: [
      {
        name: "bare backdrop-blur",
        code: `<div className="bg-background/95 backdrop-blur" />`,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "sized backdrop-blur",
        code: `<div className="bg-background/80 backdrop-blur-xl" />`,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "arbitrary backdrop-blur",
        code: `<div className="backdrop-blur-[2px]" />`,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "variant-prefixed backdrop-blur",
        code: `<div className="md:backdrop-blur-none" />`,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "supports-backdrop-filter variant",
        code: `<div className="bg-background/90 supports-backdrop-filter:bg-background/75" />`,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "class string outside className",
        code: `
        const overlayClassName = ["fixed inset-0", "backdrop-blur-lg"].join(" ");
      `,
        errors: [{ messageId: "backdropBlur" }],
      },
      {
        name: "template literal",
        code: "const header = `bg-popover/80 ${tone} backdrop-blur-sm`;",
        errors: [{ messageId: "backdropBlur" }],
      },
    ],
  }
);

ruleTester.run(
  "prefer-shared-controls",
  preferSharedControlsRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "shared button primitive",
        code: `<Button variant="ghost" size="icon-sm" aria-label="Close"><X /></Button>`,
      },
      {
        name: "bare native button rendered through a primitive",
        code: `<Item size="sm" render={<button type="button" />} onClick={open}>Row</Item>`,
      },
      {
        name: "bare native button rendered through a trigger",
        code: `<PopoverTrigger render={<button type="button" aria-label="Details" />} />`,
      },
      {
        name: "shared primitives may style native controls",
        filename: "apps/web/src/components/ui/button.tsx",
        code: `<button type="button" className="inline-flex h-9" />`,
      },
    ],
    invalid: [
      {
        name: "hand-styled button",
        code: `<button type="button" className="hover:bg-muted rounded-md px-2">Open</button>`,
        errors: [{ messageId: "raw" }],
      },
      {
        name: "unstyled button outside a render prop",
        code: `<button type="button" onClick={open}>Open</button>`,
        errors: [{ messageId: "raw" }],
      },
      {
        name: "styled button passed to a render prop",
        code: `<PopoverTrigger render={<button type="button" className="rounded-full p-1" />} />`,
        errors: [{ messageId: "raw" }],
      },
      {
        name: "native textarea",
        code: `<textarea className={textareaClassName} value={value} />`,
        errors: [{ messageId: "raw" }],
      },
      {
        name: "native input and select",
        code: `<><input value={value} /><select value={value} /></>`,
        errors: [{ messageId: "raw" }, { messageId: "raw" }],
      },
    ],
  }
);

ruleTester.run(
  "no-clipped-surface",
  noClippedSurfaceRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "scroll content padded on every side",
        code: `
        <ScrollArea className="-mx-2 min-h-0 flex-1">
          <div className="grid gap-4 px-2 pt-1 pb-6">
            <Card>Readiness</Card>
          </div>
        </ScrollArea>
      `,
      },
      {
        name: "overflow container pads itself",
        code: `
        <div className="overflow-y-auto p-4">
          <Card>Details</Card>
        </div>
      `,
      },
      {
        name: "inset rings stay inside the box",
        code: `
        <ScrollArea>
          <div className="hover:ring-1 hover:ring-inset">Row</div>
        </ScrollArea>
      `,
      },
      {
        name: "focus rings are out of scope",
        code: `
        <div className="overflow-auto">
          <a className="focus-visible:ring-2">Row</a>
        </div>
      `,
      },
      {
        name: "drag overlays render fixed, outside the clip",
        code: `
        <ScrollArea>
          <DragOverlay>
            <div className="shadow-2xl">Dragging</div>
          </DragOverlay>
        </ScrollArea>
      `,
      },
      {
        name: "clip container with its own padding",
        code: `
        <div className="overflow-hidden px-2 py-2">
          <div className="shadow-sm">Tile</div>
        </div>
      `,
      },
      {
        name: "PageScrollArea pads the sides; content pads top and bottom",
        code: `
        <PageScrollArea>
          <div className="grid gap-3 pt-1 pb-4">
            <section className="rounded-xl shadow-xs ring-1">Team</section>
          </div>
        </PageScrollArea>
      `,
      },
    ],
    invalid: [
      {
        name: "card flush against a scroll area",
        code: `
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 pt-1 pb-6">
            <Card>Readiness</Card>
          </div>
        </ScrollArea>
      `,
        errors: [{ messageId: "clipped" }],
      },
      {
        name: "ScrollArea padding does not pad its viewport",
        code: `
        <ScrollArea className="p-4">
          <Card>Readiness</Card>
        </ScrollArea>
      `,
        errors: [{ messageId: "clipped" }],
      },
      {
        name: "local component whose root is a card",
        code: `
        const ReadinessCard = () => <Card>Readiness</Card>;
        const Overview = () => (
          <ScrollArea>
            <div className="py-2">
              {checks.map((check) => (
                <ReadinessCard key={check.id} />
              ))}
            </div>
          </ScrollArea>
        );
      `,
        errors: [{ messageId: "clipped" }],
      },
      {
        name: "shadowed tile in an overflow row",
        code: `
        <div className="overflow-x-auto py-2">
          <div className="rounded-xl shadow-md">Tile</div>
        </div>
      `,
        errors: [{ messageId: "clipped" }],
      },
      {
        name: "surface flush against the top of a PageScrollArea",
        code: `
        <PageScrollArea>
          <div className="grid gap-3 pb-4">
            <section className="rounded-xl shadow-xs ring-1">Team</section>
          </div>
        </PageScrollArea>
      `,
        errors: [{ messageId: "clipped" }],
      },
      {
        name: "surface classes from a file constant",
        code: `
        const panelClassName = "rounded-xl shadow-xs ring-1";
        const gridClassName = "grid gap-3 pb-4";
        const Panel = () => <section className={cn(panelClassName, "flex")}>Team</section>;
        const Lineup = () => (
          <PageScrollArea>
            <div className={gridClassName}>
              <Panel />
            </div>
          </PageScrollArea>
        );
      `,
        errors: [{ messageId: "clipped" }],
      },
    ],
  }
);

ruleTester.run(
  "flush-list-rows",
  flushListRowsRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "ItemList squares interactive Item rows",
        code: `
        <ItemList>
          <Item render={<button type="button" />}>Someone else</Item>
        </ItemList>
      `,
      },
      {
        name: "square hover row flush in a rounded clip",
        code: `
        <div className="overflow-hidden rounded-lg border">
          <article className="hover:bg-muted/30 px-3 py-2.5">Row</article>
        </div>
      `,
      },
      {
        name: "padded rounded container insets its rows",
        code: `
        <div className="overflow-hidden rounded-xl border p-1">
          <Item render={<button type="button" />}>Row</Item>
        </div>
      `,
      },
      {
        name: "unrounded divided list",
        code: `<ul className="divide-border flex flex-col divide-y"><li>Row</li></ul>`,
      },
      {
        name: "Item squared explicitly",
        code: `
        <div className="overflow-hidden rounded-xl border">
          <Item className="rounded-none" render={<button type="button" />}>
            Row
          </Item>
        </div>
      `,
      },
      {
        name: "plain Item leaves the hover to its row",
        code: `
        <div className="overflow-hidden rounded-lg border">
          <div className={cn("group/row", tone.hover)}>
            <Item variant="plain" render={<button type="button" />}>Row</Item>
          </div>
        </div>
      `,
      },
      {
        name: "hover-only radius on a flush row",
        code: `
        <div className="overflow-hidden rounded-xl border">
          <div className="hover:bg-muted focus-visible:rounded-md">Row</div>
        </div>
      `,
      },
    ],
    invalid: [
      {
        name: "hand-rolled rounded divided list",
        code: `
        <div className="divide-y overflow-hidden rounded-xl border">
          <Row />
        </div>
      `,
        errors: [{ messageId: "useItemList" }],
      },
      {
        name: "rounded divided list without a clip",
        code: `<ul className="divide-y rounded-xl border"><li>Row</li></ul>`,
        errors: [{ messageId: "useItemList" }],
      },
      {
        name: "interactive Item flush in a rounded clip",
        code: `
        <div className="overflow-hidden rounded-lg border">
          <Item render={<button type="button" />}>Row</Item>
        </div>
      `,
        errors: [{ messageId: "rowRadius" }],
      },
      {
        name: "rounded hover row inside ItemList",
        code: `
        <ItemList>
          <div className="hover:bg-muted rounded-2xl px-3 py-2">Row</div>
        </ItemList>
      `,
        errors: [{ messageId: "rowRadius" }],
      },
      {
        name: "Item behind an unpadded wrapper in a local component",
        code: `
        const AccountRow = () => (
          <li className="relative">
            <Item render={<button type="button" />}>Account</Item>
          </li>
        );
        const Accounts = () => (
          <div className="overflow-hidden rounded-2xl border">
            <AccountRow />
          </div>
        );
      `,
        errors: [{ messageId: "rowRadius" }],
      },
    ],
  }
);

ruleTester.run(
  "no-nudged-icon",
  noNudgedIconRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "icon centered in a one-line box",
        code: `
        <li className="flex items-start gap-2">
          <span className="flex h-lh shrink-0 items-center"><Check className="size-4" /></span>
          <span>Text</span>
        </li>
      `,
      },
      {
        name: "margin on text that is not a fixed-size mark",
        code: `<p className="mt-1 text-sm">Detail</p>`,
      },
      {
        name: "skeleton sized with height and width",
        code: `<Skeleton className="mt-1 h-3 w-24" />`,
      },
      {
        name: "nudge only behind a variant",
        code: `<span className="size-4 group-hover:translate-y-0.5" />`,
      },
    ],
    invalid: [
      {
        name: "icon pushed down with a pixel margin",
        code: `<Mail className="mt-px size-3.5 shrink-0" />`,
        errors: [{ messageId: "nudgedIcon" }],
      },
      {
        name: "dot pushed down inside cn",
        code: `<span className={cn("mt-1.5 size-1.5 rounded-full", tone)} />`,
        errors: [{ messageId: "nudgedIcon" }],
      },
      {
        name: "named icon translated",
        code: `<ArrowDownIcon className="translate-y-px" />`,
        errors: [{ messageId: "nudgedIcon" }],
      },
    ],
  }
);

ruleTester.run(
  "batch-gate-uses-batch-has-answered",
  batchGateUsesBatchHasAnsweredRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "gate through batchHasAnswered",
        code: `
        useQueries({
          queries: batches.map((ids, index) => {
            const gate = batches[index - CONCURRENCY];
            return {
              queryKey: ids,
              enabled: gate === undefined || batchHasAnswered(stateOf(gate), freshSince),
            };
          }),
        });`,
      },
      {
        name: "enabled unrelated to a batch ahead",
        code: `
        const previous = items[index - 1];
        useQuery({ queryKey: key, enabled: slot !== null });`,
      },
    ],
    invalid: [
      {
        name: "hand-rolled settled check on the batch ahead",
        code: `
        useQueries({
          queries: batches.map((ids, index) => {
            const gate = batches[index - CONCURRENCY];
            return {
              queryKey: ids,
              enabled: gate === undefined || isSettled(queryClient, gate),
            };
          }),
        });`,
        errors: [{ messageId: "handRolledGate" }],
      },
      {
        name: "gate state read inline",
        code: `
        const gate = options[index - 2];
        const query = {
          enabled: queryClient.getQueryState(gate.queryKey)?.status === "success",
        };`,
        errors: [{ messageId: "handRolledGate" }],
      },
    ],
  }
);

ruleTester.run(
  "menu-label-inside-group",
  menuLabelInsideGroupRule as Parameters<typeof ruleTester.run>[1],
  {
    valid: [
      {
        name: "label inside a menu group",
        code: `
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Section</DropdownMenuLabel>
            <DropdownMenuItem>Verse</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>`,
      },
      {
        name: "label inside a radio group",
        code: `
        <DropdownMenuRadioGroup>
          <DropdownMenuLabel>Rewrite chords in</DropdownMenuLabel>
          <DropdownMenuRadioItem value="G">G</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>`,
      },
      {
        name: "label rendered from a map callback inside a group",
        code: `
        <DropdownMenuGroup>
          {sections.map((section) => (
            <DropdownMenuLabel key={section}>{section}</DropdownMenuLabel>
          ))}
        </DropdownMenuGroup>`,
      },
      {
        name: "base ui group label inside Menu.Group",
        code: `
        <Menu.Group>
          <Menu.GroupLabel>Section</Menu.GroupLabel>
        </Menu.Group>`,
      },
      {
        name: "primitive group label inside MenuPrimitive.RadioGroup",
        code: `
        <MenuPrimitive.RadioGroup>
          <MenuPrimitive.GroupLabel>Rewrite chords in</MenuPrimitive.GroupLabel>
        </MenuPrimitive.RadioGroup>`,
      },
      {
        name: "unrelated group label",
        code: `<Sidebar.GroupLabel>Files</Sidebar.GroupLabel>`,
      },
      {
        name: "primitive file defines GroupLabel",
        filename: "apps/web/src/components/ui/dropdown-menu.tsx",
        code: `
        const DropdownMenuLabel = () => (
          <MenuPrimitive.GroupLabel className="label" />
        );`,
      },
    ],
    invalid: [
      {
        name: "label directly in menu content",
        code: `
        <DropdownMenuContent>
          <DropdownMenuLabel>Section</DropdownMenuLabel>
          <DropdownMenuItem>Verse</DropdownMenuItem>
        </DropdownMenuContent>`,
        errors: [{ messageId: "outsideGroup" }],
      },
      {
        name: "helper that returns only a label",
        code: `
        const SectionLabel = () => <DropdownMenuLabel>Section</DropdownMenuLabel>;`,
        errors: [{ messageId: "outsideGroup" }],
      },
      {
        name: "Menu.GroupLabel outside a group",
        code: `
        <Menu.Popup>
          <Menu.GroupLabel>Section</Menu.GroupLabel>
        </Menu.Popup>`,
        errors: [{ messageId: "outsideGroup" }],
      },
      {
        name: "MenuPrimitive.GroupLabel outside a group",
        code: `<MenuPrimitive.GroupLabel>Section</MenuPrimitive.GroupLabel>`,
        errors: [{ messageId: "outsideGroup" }],
      },
    ],
  }
);

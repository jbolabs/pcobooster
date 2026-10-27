import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { PlusIcon } from "lucide-react";

const Accordion = ({ className, ...props }: AccordionPrimitive.Root.Props) => (
  <AccordionPrimitive.Root
    data-slot="accordion"
    className={cn("flex w-full flex-col", className)}
    {...props}
  />
);

const accordionItemVariants = cva("", {
  variants: {
    variant: {
      default: "border-border border-b first:border-t",
      // Rows without rules, for a quiet list such as every key change.
      plain: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const AccordionItem = ({
  className,
  variant = "default",
  ...props
}: AccordionPrimitive.Item.Props &
  VariantProps<typeof accordionItemVariants>) => (
  <AccordionPrimitive.Item
    data-slot="accordion-item"
    className={cn(accordionItemVariants({ variant }), className)}
    {...props}
  />
);

const accordionTriggerVariants = cva(
  "group/accordion-trigger text-body focus-visible:ring-ring/30 flex flex-1 cursor-pointer items-center justify-between gap-6 text-left font-medium outline-none focus-visible:rounded-md focus-visible:ring-3 aria-disabled:pointer-events-none aria-disabled:opacity-50 md:text-base",
  {
    variants: {
      size: {
        default: "py-5",
        // Short rows, such as a long list of keys.
        compact: "py-2.5",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

const AccordionTrigger = ({
  className,
  size = "default",
  children,
  ...props
}: AccordionPrimitive.Trigger.Props &
  VariantProps<typeof accordionTriggerVariants>) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn(accordionTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <PlusIcon
        aria-hidden
        strokeWidth={1.75}
        className="text-muted-foreground group-hover/accordion-trigger:text-foreground group-aria-expanded/accordion-trigger:text-foreground ease-snappy size-4.5 shrink-0 transition-transform duration-200 group-aria-expanded/accordion-trigger:rotate-45"
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
);

/**
 * Closed answers stay in the prerendered HTML (`hidden="until-found"`), so search engines read
 * them and find-in-page opens the matching question.
 */
const accordionContentVariants = cva("pb-6", {
  variants: {
    variant: {
      // Prose answers, such as the FAQ.
      default:
        "text-muted-foreground [&_a]:hover:text-foreground max-w-150 md:pr-10 [&_a]:underline [&_a]:underline-offset-3",
      // A panel of link buttons, such as every key change from one key.
      links: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const AccordionContent = ({
  className,
  variant = "default",
  children,
  ...props
}: AccordionPrimitive.Panel.Props &
  VariantProps<typeof accordionContentVariants>) => (
  <AccordionPrimitive.Panel
    data-slot="accordion-content"
    hiddenUntilFound
    className="ease-snappy h-(--accordion-panel-height) overflow-hidden transition-[height] duration-250 data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none"
    {...props}
  >
    <div className={cn(accordionContentVariants({ variant }), className)}>
      {children}
    </div>
  </AccordionPrimitive.Panel>
);

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

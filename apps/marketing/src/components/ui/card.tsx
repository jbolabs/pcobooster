import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type { ComponentProps } from "react";

const Card = ({
  className,
  size = "default",
  ...props
}: ComponentProps<"div"> & { size?: "default" | "sm" }) => (
  <div
    data-slot="card"
    data-size={size}
    className={cn(
      "group/card bg-card text-card-foreground ring-foreground/5 flex flex-col gap-(--card-spacing) overflow-hidden rounded-4xl py-(--card-spacing) text-sm shadow-md ring-1 [--card-spacing:--spacing(6)] data-[size=sm]:[--card-spacing:--spacing(4)]",
      className
    )}
    {...props}
  />
);

const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-header"
    className={cn(
      "group/card-header grid auto-rows-min grid-cols-1 items-start gap-1.5 px-(--card-spacing)",
      className
    )}
    {...props}
  />
);

const cardTitleVariants = cva("", {
  variants: {
    variant: {
      default: "text-base font-medium",
      // Large names, such as the pricing plans.
      display: "font-book text-3xl tracking-tight",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

const CardTitle = ({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof cardTitleVariants>) => (
  <div
    data-slot="card-title"
    className={cn(cardTitleVariants({ variant }), className)}
    {...props}
  />
);

const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-description"
    className={cn("text-muted-foreground text-sm leading-relaxed", className)}
    {...props}
  />
);

const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-content"
    className={cn("px-(--card-spacing)", className)}
    {...props}
  />
);

const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-footer"
    className={cn("flex items-center px-(--card-spacing)", className)}
    {...props}
  />
);

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};

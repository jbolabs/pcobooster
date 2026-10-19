import {
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Alert02Icon,
  MultiplicationSignCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

import { useTheme } from "@/components/theme-provider";

type SonnerStyle = CSSProperties & Record<`--${string}`, string>;

/** Sonner's own gaps from the viewport edge, plus the notch and home indicator. */
const safeOffset = (gap: string): NonNullable<ToasterProps["offset"]> => ({
  top: `calc(${gap} + env(safe-area-inset-top, 0px))`,
  right: `calc(${gap} + env(safe-area-inset-right, 0px))`,
  bottom: `calc(${gap} + env(safe-area-inset-bottom, 0px))`,
  left: `calc(${gap} + env(safe-area-inset-left, 0px))`,
});

const toasterStyle: SonnerStyle = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius-3xl, 1.5rem)",
  "--width": "356px",
};

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      className="group"
      icons={{
        success: (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            className="size-4"
          />
        ),
        info: (
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className="size-4"
          />
        ),
        warning: (
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="size-4"
          />
        ),
        error: (
          <HugeiconsIcon
            icon={MultiplicationSignCircleIcon}
            strokeWidth={2}
            className="size-4"
          />
        ),
        loading: (
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            className="size-4 animate-spin"
          />
        ),
      }}
      style={toasterStyle}
      offset={safeOffset("24px")}
      mobileOffset={safeOffset("16px")}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-3xl !border-0 !bg-popover !px-4 !py-3 !text-sm !text-popover-foreground !shadow-lg !ring-1 !ring-foreground/5 dark:!ring-foreground/10",
          title: "!font-medium",
          description: "!text-muted-foreground",
          icon: "!mr-0.5",
          success: "[&_[data-icon]]:text-status-confirmed",
          error: "[&_[data-icon]]:text-status-declined",
          warning: "[&_[data-icon]]:text-status-scheduled",
          info: "[&_[data-icon]]:text-status-info",
          actionButton:
            "!rounded-2xl !bg-primary !font-medium !text-primary-foreground",
          cancelButton:
            "!rounded-2xl !bg-secondary !font-medium !text-secondary-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

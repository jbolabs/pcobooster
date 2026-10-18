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
  "--border-radius": "var(--radius)",
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
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

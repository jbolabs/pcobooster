import { cn } from "cn";

import { RocketLoaderMark } from "@/components/rocket-loader-mark";

/** The loading indicator: the rocket hopping and puffing, in the surrounding text color. */
const Spinner = ({
  className,
  ...props
}: React.ComponentProps<typeof RocketLoaderMark>) => (
  <RocketLoaderMark
    data-slot="spinner"
    /* eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- The spinner renders an SVG mark, so output cannot replace its status role. */
    role="status"
    aria-label="Loading"
    className={cn("rocket-puff size-4 shrink-0", className)}
    {...props}
  />
);

export { Spinner };

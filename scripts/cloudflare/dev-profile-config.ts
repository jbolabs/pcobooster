export interface DevelopmentProfile {
  readonly kind: "sandbox" | "church" | "church-write";
  readonly readOnly: boolean;
  readonly label: string;
}

/** Writes to the church require the explicit church-write command, never an inherited setting. */
export const resolveDevelopmentProfile = (
  args: readonly string[]
): DevelopmentProfile => {
  if (
    args.some(
      (argument) => !["--church", "--write", "--present"].includes(argument)
    )
  ) {
    throw new Error("Unknown development profile option.");
  }
  if (!args.includes("--church")) {
    if (args.includes("--write")) {
      throw new Error(
        "--write requires --church; sandbox writes are already enabled."
      );
    }
    return {
      kind: "sandbox",
      readOnly: false,
      label: "Sandbox · writes enabled",
    };
  }
  return args.includes("--write")
    ? { kind: "church-write", readOnly: false, label: "Agape · LIVE WRITES" }
    : { kind: "church", readOnly: true, label: "Agape · read-only" };
};

export const churchOrganization = {
  id: "42167",
  name: "Agape Christian Church of Orange County",
} as const;

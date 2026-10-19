/**
 * The Release Hermes gate's pure rules: which engine the app ships, what a probe must report,
 * and the known regression the gate must keep failing on. `gate.ts` does the I/O.
 */
import { Option, Schema } from "effect";

const ProbeRouteSchema = Schema.Struct({
  tag: Schema.String,
  method: Schema.String,
  path: Schema.String,
  params: Schema.Array(Schema.String),
});

/** A route as the contracts declare it and as the probe reports it from Hermes. */
export type ProbeRoute = typeof ProbeRouteSchema.Type;

/** What a passing probe prints through `__pcobReport`. */
const ProbeReportSchema = Schema.Struct({
  status: Schema.String,
  api: Schema.String,
  wireApi: Schema.String,
  groups: Schema.Array(Schema.String),
  routes: Schema.Array(ProbeRouteSchema),
  runtime: Schema.Record(Schema.String, Schema.Unknown),
});

const decodeReport = Schema.decodeUnknownOption(
  Schema.fromJsonString(ProbeReportSchema)
);

export interface ProbeRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** What the Node side of the gate computed from the same source, for comparison. */
export interface Expected {
  readonly hermesVersion: string;
  readonly bytecodeVersion: number;
  readonly groups: readonly string[];
  readonly routes: readonly ProbeRoute[];
}

/** The build 371 fatal: Hermes `matchAll` drops named groups, so the old parser named no params. */
export const OLD_ROUTE_PARSER_FATAL =
  "/service-types/:serviceTypeId/plans names params [] but declares [serviceTypeId]";

const CURRENT_PARAM_NAMES = `const paramNames = (path: Path): string[] =>
  path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));`;

/** The parser builds 370 and 371 shipped (`682f5d20`), byte for byte. */
const OLD_PARAM_NAMES = `const PATH_PARAM = /:(?<name>[A-Za-z]+)/gu;

const paramNames = (path: Path): string[] =>
  [...path.matchAll(PATH_PARAM)].map((match) => match.groups?.name ?? "");`;

/**
 * `endpoint.ts` with the old named-group parser put back. Fails when the current parser moved,
 * so the regression check cannot silently test nothing.
 */
export const withOldRouteParser = (endpointSource: string): string => {
  const index = endpointSource.indexOf(CURRENT_PARAM_NAMES);
  if (index === -1 || endpointSource.includes(CURRENT_PARAM_NAMES, index + 1)) {
    throw new Error(
      "endpoint.ts no longer contains the current paramNames parser exactly once; update the Release Hermes gate's regression"
    );
  }
  return endpointSource.replace(CURRENT_PARAM_NAMES, OLD_PARAM_NAMES);
};

const VERSION_LINE = /^HERMES_VERSION_NAME=(?<version>\S+)$/mu;

/** The Hermes version React Native's podspec installs (`sdks/hermes-engine/version.properties`). */
export const hermesVersionFromProperties = (properties: string): string => {
  const version = VERSION_LINE.exec(properties)?.groups?.version;
  if (version === undefined) {
    throw new Error("version.properties has no HERMES_VERSION_NAME");
  }
  return version;
};

const HERMESC_RELEASE = /Hermes release version: (?<version>\S+)/u;
const HERMESC_BYTECODE = /HBC bytecode version: (?<bytecode>\d+)/u;

export interface HermescVersion {
  readonly version: string;
  readonly bytecodeVersion: number;
}

/** The release and bytecode versions `hermesc -version` prints. */
export const parseHermescVersion = (output: string): HermescVersion => {
  const version = HERMESC_RELEASE.exec(output)?.groups?.version;
  const bytecode = HERMESC_BYTECODE.exec(output)?.groups?.bytecode;
  if (version === undefined || bytecode === undefined) {
    throw new Error(
      "hermesc -version did not report its release and bytecode versions"
    );
  }
  return { version, bytecodeVersion: Number(bytecode) };
};

const PODFILE_HERMES = /^ {2}- hermes-engine \((?<version>[^)]+)\):$/mu;

/** The hermes-engine version a generated `ios/Podfile.lock` pinned, when one exists. */
export const hermesVersionFromPodfileLock = (lock: string): string | null =>
  PODFILE_HERMES.exec(lock)?.groups?.version ?? null;

/** Hermes bytecode files start with this magic number, then a little-endian uint32 version. */
const HBC_MAGIC = 0x1f_19_03_c1_03_bc_1f_c6n;

/** The bytecode version of a Hermes bundle, or null when the bytes are not Hermes bytecode. */
export const hbcVersion = (bytes: Uint8Array): number | null => {
  const minimumLength = 12;
  if (bytes.length < minimumLength) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getBigUint64(0, true) === HBC_MAGIC
    ? view.getUint32(8, true)
    : null;
};

/** A matching header alone is insufficient: the shipped compiler must parse the full bytecode. */
export const archiveBundleProblems = (
  bytes: Uint8Array,
  version: number,
  inspection: ProbeRun
): string[] => {
  const problems: string[] = [];
  if (hbcVersion(bytes) !== version) {
    problems.push(`Archived bundle is not Hermes bytecode version ${version}`);
  }
  if (inspection.exitCode !== 0) {
    problems.push(
      `Archived bytecode failed the matching Hermes reader: ${inspection.stderr.trim()}`
    );
  }
  return problems;
};

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const routeKey = (route: ProbeRoute): string =>
  `${route.method} ${route.path} [${route.params.join(",")}]`;

/** Why a probe that should pass did not, or an empty list when it passed. */
export const passingProbeProblems = (
  run: ProbeRun,
  expected: Expected
): string[] => {
  if (run.exitCode !== 0) {
    return [`exited ${run.exitCode}: ${run.stderr.trim()}`];
  }
  const decoded = decodeReport(run.stdout.trim());
  if (Option.isNone(decoded)) {
    return [`printed no report: ${run.stdout.trim()}`];
  }
  const report = decoded.value;
  const problems: string[] = [];
  if (report.status !== "PASS") {
    problems.push(`reported ${report.status}`);
  }
  if (report.api !== "pcobooster" || report.wireApi !== "pcobooster") {
    problems.push(`built APIs ${report.api} and ${report.wireApi}`);
  }
  if (report.runtime["OSS Release Version"] !== expected.hermesVersion) {
    problems.push(
      `ran on Hermes ${String(report.runtime["OSS Release Version"])}`
    );
  }
  if (report.runtime["Bytecode Version"] !== expected.bytecodeVersion) {
    problems.push(
      `ran bytecode version ${String(report.runtime["Bytecode Version"])}`
    );
  }
  if (report.runtime.Build !== "Release") {
    problems.push(`ran a ${String(report.runtime.Build)} engine`);
  }
  if (!sameList(report.groups, expected.groups)) {
    problems.push(`client groups [${report.groups.join(", ")}]`);
  }
  const hermesRoutes = new Set(report.routes.map(routeKey));
  const nodeRoutes = new Set(expected.routes.map(routeKey));
  for (const route of nodeRoutes.difference(hermesRoutes)) {
    problems.push(`Hermes lacks route ${route}`);
  }
  for (const route of hermesRoutes.difference(nodeRoutes)) {
    problems.push(`Hermes has unexpected route ${route}`);
  }
  return problems;
};

/** Why the regression probe did not fail the way build 371 did, or an empty list when it did. */
export const regressionProbeProblems = (run: ProbeRun): string[] => {
  if (run.exitCode === 0) {
    return [
      "the old route parser passed; the gate no longer reproduces the build 371 fatal",
    ];
  }
  return run.stderr.includes(OLD_ROUTE_PARSER_FATAL)
    ? []
    : [`failed differently from build 371: ${run.stderr.trim()}`];
};

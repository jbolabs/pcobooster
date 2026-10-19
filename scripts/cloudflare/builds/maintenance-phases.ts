export interface MaintenancePhase {
  name: string;
  run: () => void | Promise<void>;
}

/** Complete independent maintenance reports even when another phase fails. */
export const maintenancePhases = async (
  phases: readonly MaintenancePhase[]
): Promise<void> => {
  const failures: Error[] = [];
  for (const phase of phases) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- all phases share the stateful deployment lane
      await phase.run();
    } catch (error) {
      failures.push(
        new Error(`Maintenance failed: ${phase.name}`, { cause: error })
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Maintenance phases failed");
  }
};

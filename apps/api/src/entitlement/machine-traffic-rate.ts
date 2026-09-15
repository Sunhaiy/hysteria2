/** Legacy unassigned endpoints retain a deterministic tier default. */
export function defaultMachineRate(name: string): number {
  return name.includes('顶级') ? 20_000 : 10_000;
}

export function machineTrafficRate(node: {
  label: string;
  server?: { trafficMultiplierBasisPoints: number } | null;
}): number {
  return (
    node.server?.trafficMultiplierBasisPoints ?? defaultMachineRate(node.label)
  );
}

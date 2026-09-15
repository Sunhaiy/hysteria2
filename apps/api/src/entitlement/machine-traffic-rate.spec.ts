import { defaultMachineRate, machineTrafficRate } from './machine-traffic-rate';

describe('machine traffic rates', () => {
  it('defaults top tier to 2x and intermediate tier to 1x', () => {
    expect(defaultMachineRate('[顶级]美国')).toBe(20_000);
    expect(defaultMachineRate('[中级]日本')).toBe(10_000);
  });
  it('shares an explicit machine rate across protocol labels', () => {
    const server = { trafficMultiplierBasisPoints: 15_000 };
    expect(machineTrafficRate({ label: '[顶级] Hysteria2', server })).toBe(
      15_000,
    );
    expect(machineTrafficRate({ label: 'VLESS', server })).toBe(15_000);
    expect(machineTrafficRate({ label: '[顶级] legacy', server: null })).toBe(
      20_000,
    );
  });
});

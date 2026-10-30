import { expect, it } from "vitest";
import { getDiscoveryInterfaces } from "../../src/main/netInfo";
it("uses each LAN subnet broadcast and excludes tunnel and benchmark addresses", () => {
  const iface = (address: string, netmask: string) => ({ address, netmask, family: "IPv4", internal: false, mac: "00:00:00:00:00:00", cidr: null } as const);
  expect(getDiscoveryInterfaces({ en0: [iface("192.168.0.10", "255.255.255.0")], Ethernet: [iface("10.2.3.4", "255.255.0.0")], utun4: [iface("198.18.0.1", "255.254.0.0")] }))
    .toEqual([{ name: "en0", address: "192.168.0.10", broadcast: "192.168.0.255" }, { name: "Ethernet", address: "10.2.3.4", broadcast: "10.2.255.255" }]);
});

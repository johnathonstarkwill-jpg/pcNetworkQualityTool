import os from "node:os";

// Non-internal IPv4 addresses of this machine, shown to the operator so the
// other machine can connect by manual IP, and used as the client's address.
export function listLocalIpv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item): item is os.NetworkInterfaceInfo => item !== undefined && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

export interface DiscoveryInterface { name: string; address: string; broadcast: string; }
export function getDiscoveryInterfaces(interfaces = os.networkInterfaces()): DiscoveryInterface[] {
  const result: DiscoveryInterface[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (/^(utun|tun\d|tap\d|wg\d|tailscale)/i.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || /^198\.(18|19)\./.test(entry.address)) continue;
      const parts = entry.address.split(".").map(Number), mask = entry.netmask.split(".").map(Number);
      if (parts.length !== 4 || mask.length !== 4 || [...parts, ...mask].some(n => !Number.isInteger(n) || n < 0 || n > 255)) continue;
      const bits = mask.map(n => n.toString(2).padStart(8, "0")).join("");
      if (!/^1+0{2,}$/.test(bits)) continue; // /31 and /32 have no broadcast hosts.
      result.push({ name, address: entry.address, broadcast: parts.map((n, i) => n | (255 ^ mask[i])).join(".") });
    }
  }
  return result;
}

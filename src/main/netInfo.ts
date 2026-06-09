import os from "node:os";

// Non-internal IPv4 addresses of this machine, shown to the operator so the
// other machine can connect by manual IP, and used as the client's address.
export function listLocalIpv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item): item is os.NetworkInterfaceInfo => item !== undefined && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

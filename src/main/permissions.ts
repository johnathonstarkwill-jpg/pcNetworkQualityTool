export interface PermissionGuidance {
  platform: NodeJS.Platform;
  requiresAdminForRepair: boolean;
  messages: string[];
}

export function getPermissionGuidance(platform: NodeJS.Platform = process.platform): PermissionGuidance {
  if (platform === "win32") {
    return {
      platform,
      requiresAdminForRepair: true,
      messages: [
        "Windows 防火墙可能会弹出允许访问提示，请选择允许。",
        "若无法发现或连接：允许本程序和 iperf3 通过 Windows 防火墙的专用网络；控制 TCP 48200、发现 UDP 48101/48102、测速 TCP/UDP 5201。"
      ]
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      requiresAdminForRepair: false,
      messages: [
        "macOS 可能会请求本地网络访问权限，请选择允许。",
        "如果搜索或连接失败：打开系统设置 → 隐私与安全性 → 本地网络，允许 PC Network Quality Tool，然后退出并重新打开程序。"
      ]
    };
  }

  return {
    platform,
    requiresAdminForRepair: false,
    messages: ["请确认系统允许本软件访问本地网络。"]
  };
}

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
        "如果客户端无法连接，请以管理员身份运行并点击自动修复。"
      ]
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      requiresAdminForRepair: false,
      messages: [
        "macOS 可能会请求本地网络访问权限，请选择允许。",
        "如果搜索不到服务器，请在系统设置中确认本软件允许访问本地网络。"
      ]
    };
  }

  return {
    platform,
    requiresAdminForRepair: false,
    messages: ["请确认系统允许本软件访问本地网络。"]
  };
}

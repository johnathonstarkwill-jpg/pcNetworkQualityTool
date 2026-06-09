import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("networkTool", {
  version: "0.1.0"
});

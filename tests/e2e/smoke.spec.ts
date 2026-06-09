import { test, expect } from "@playwright/test";

test("renderer shows role selection", async ({ page }) => {
  await page.goto("http://127.0.0.1:5173");

  await expect(page.getByRole("heading", { name: "网络质量测试工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "作为服务器" })).toBeVisible();
  await expect(page.getByRole("button", { name: "作为客户端" })).toBeVisible();
});

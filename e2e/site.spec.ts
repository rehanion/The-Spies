import { expect, test } from "@playwright/test";
import { createUser, login, pngBytes, serviceClient, uniq } from "./helpers";

test("security headers and CSP nonce are sent", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["content-security-policy"]).toMatch(/script-src[^;]*'nonce-/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBeTruthy();
  expect(h["x-powered-by"]).toBeUndefined();
  const html = await res.text();
  expect(html).not.toMatch(/sb_secret_|service_role|SUPABASE_SECRET_KEY|PROCESSOR_SECRET/);
});

test("unknown pages return 404 and protected pages redirect to login", async ({ request }) => {
  expect((await request.get("/t/does-not-exist-xyz")).status()).toBe(404);
  for (const path of ["/dashboard", "/account", "/library", "/admin"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([303, 307, 308]).toContain(res.status());
    expect(res.headers().location).toContain("/login");
  }
});

test("regular users cannot open the admin area", async ({ page }) => {
  const u = await createUser(uniq("e2eplain"));
  await login(page, u.email, "/library");
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/);
});

test("anonymous visitors can file a report", async ({ page }) => {
  await page.goto("/report");
  await page.getByLabel("What is wrong?").selectOption("other");
  await page.getByLabel("Details").fill("The e2e test checks that anonymous reports reach the moderators.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thank you" })).toBeVisible();
  const { data } = await serviceClient().from("reports").select("id").ilike("details", "The e2e test checks%").limit(1);
  expect(data?.length).toBe(1);
});

test("copyright complaints require the rights holder details", async ({ page }) => {
  await page.goto("/copyright");
  await expect(page.getByLabel("Rights holder name")).toBeVisible();
  await expect(page.getByLabel(/Contact email/)).toHaveAttribute("required", "");
});

test("users edit their profile and upload an avatar that is re-encoded", async ({ page }) => {
  const u = await createUser(uniq("e2eprof"));
  await login(page, u.email, "/account");
  await page.getByLabel("Display name").fill("E2E Display");
  await page.getByLabel("Bio").fill("Scalper. Testing SPIES.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();

  await page.getByLabel("Choose an avatar image").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await pngBytes(300, 300, 0x5577aaff) });
  await expect(page.getByRole("status").filter({ hasText: "Avatar updated." })).toBeVisible();
  const { data } = await serviceClient().from("profiles").select("avatar_key, display_name").eq("id", u.id).single();
  expect(data?.display_name).toBe("E2E Display");
  expect(data?.avatar_key).toMatch(/^avatars\/[0-9a-f-]{36}\.jpg$/);

  await page.goto(`/u/${u.username}`);
  await expect(page.getByRole("heading", { name: "E2E Display" })).toBeVisible();
  await expect(page.getByText("Scalper. Testing SPIES.")).toBeVisible();
});

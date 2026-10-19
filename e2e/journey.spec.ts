import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, confirmationLink, createUser, login, logout, pngBytes, serviceClient, sha256, uniq } from "./helpers";

// The whole product journey on a local stack: signup → one-page upload →
// quarantine and validation → automatic ClamAV scan → auto-publish →
// controlled download → views, comments, follows, ratings and saves.
test.describe.configure({ mode: "serial" });

const creatorName = uniq("e2ecreator");
const creatorEmail = `${creatorName}@example.test`;
const title = `E2E Quantower workspace ${creatorName.slice(-8)}`;
const xml = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<Workspace name="E2E"><Panel type="Chart" symbol="ES"/></Workspace>\n');
let slug = "";
let templateId = "";
let fileId = "";

const status = async () => (await serviceClient().from("templates").select("publication_status").eq("id", templateId).single()).data?.publication_status;

/** Runs the same scanner the hourly GitHub job runs. Falls back to the admin form if ClamAV is not installed. */
async function scanPendingFiles(page: Page) {
  const scanner = await createUser(uniq("e2escanner"), "moderator");
  const hasClam = spawnSync("clamscan", ["--version"]).status === 0;
  if (hasClam) {
    // A one-line test signature database that matches nothing in these files.
    const dir = mkdtempSync(join(tmpdir(), "spies-e2e-"));
    const db = join(dir, "e2e.hdb");
    writeFileSync(db, "00000000000000000000000000000000:1:SPIES.E2E.NoMatch\n");
    const r = spawnSync("node", ["scripts/admin-scan.mjs", "--database", db], {
      encoding: "utf8",
      env: { ...process.env, SPIES_ADMIN_EMAIL: scanner.email, SPIES_ADMIN_PASSWORD: PASSWORD },
    });
    expect(r.stdout, r.stderr).toContain(`✓ ${fileId}: clean`);
    return;
  }
  await login(page, scanner.email, "/admin/queue");
  await page.goto(`/admin/submissions/${templateId}`);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download quarantined file for scanning" }).click(),
  ]);
  const scanned = readFileSync((await download.path())!);
  await page.getByLabel("Engine version").fill("ClamAV (e2e)");
  await page.getByLabel("Signature database").fill("e2e");
  await page.getByLabel("SHA-256 of the scanned file").fill(sha256(scanned));
  await page.getByRole("button", { name: "Record scan result" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scan recorded: clean" })).toBeVisible();
  await logout(page);
}

test("visitor signs up and confirms the email", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Username").fill(creatorName);
  await page.getByLabel("Email").fill(creatorEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(/confirm/i);

  const link = await confirmationLink(creatorEmail);
  await page.goto(link);
  await page.waitForURL("**/dashboard");
});

test("renamed executables are rejected by content, not by name", async ({ page }) => {
  await login(page, creatorEmail);
  await page.goto("/dashboard/new");
  await page.getByLabel("Title").fill("Rejected upload check");
  await page.getByLabel("Platform", { exact: true }).selectOption("quantower");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL("**/dashboard/submissions/**");
  const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]);
  await page.getByLabel("Choose a template file").setInputFiles({ name: "evil.xml", mimeType: "text/xml", buffer: exe });
  await expect(page.getByRole("alert").filter({ hasText: "Windows executable" })).toBeVisible();
});

test("creator publishes with the one-page upload and it waits for the virus scan", async ({ page }) => {
  await login(page, creatorEmail);
  await page.getByRole("link", { name: "Upload a template" }).first().click();
  await page.waitForURL("**/upload");
  await page.getByLabel("Choose template files").setInputFiles({ name: "ES order flow.xml", mimeType: "text/xml", buffer: xml });
  // The title comes from the file name. .xml fits Quantower and ATAS, so the creator picks the platform.
  await expect(page.getByLabel("Title")).toHaveValue("ES order flow");
  await expect(page.getByLabel("Platform", { exact: true })).toHaveValue("");
  await page.getByLabel("Platform", { exact: true }).selectOption("quantower");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Choose screenshots").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: await pngBytes() });
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByLabel("Description").fill("Generated by the automated end-to-end test. Not a real template.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL("**/t/**?uploaded=1");
  await expect(page.getByText("It goes live automatically once the virus scan has passed.")).toBeVisible();

  const { data } = await serviceClient().from("templates").select("id, slug, publication_status, template_files(id, sha256, scan_status, is_current)").eq("title", title).single();
  expect(data?.publication_status).toBe("pending");
  const current = data!.template_files.filter((f) => f.is_current);
  expect(current).toHaveLength(1);
  expect(current[0].sha256).toBe(sha256(xml));
  slug = data!.slug;
  templateId = data!.id;
  fileId = current[0].id;
});

test("pending uploads are not public and cannot be downloaded", async ({ page, request }) => {
  expect((await request.get(`/t/${slug}`)).status()).toBe(404);
  const reader = await createUser(uniq("e2ereader"));
  await login(page, reader.email, "/library");
  const dl = await page.request.get(`/api/download/${fileId}`, { headers: { accept: "application/json" }, maxRedirects: 0 });
  expect([403, 404]).toContain(dl.status());
});

test("the automatic scan records ClamAV results and auto-publishes the listing", async ({ page }) => {
  await scanPendingFiles(page);
  expect(await status()).toBe("approved");
});

test("visitors watch, download, comment, follow, rate and save", async ({ page }) => {
  await logout(page);
  await page.goto(`/browse?q=${encodeURIComponent(title.split(" ").slice(-1)[0])}`);
  await page.getByRole("link", { name: title }).first().click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/ClamAV scan passed/i)).toBeVisible();
  await expect(page.getByText(/100% (virus|safe)/i)).toHaveCount(0);

  const anon = await page.request.get(`/api/download/${fileId}`, { maxRedirects: 0 });
  expect(anon.status()).toBe(303);
  expect(anon.headers().location).toContain("/login");

  const user = await createUser(uniq("e2euser"));
  await login(page, user.email, `/t/${slug}`);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Download/ }).first().click()]);
  expect(sha256(await readFile((await download.path())!))).toBe(sha256(xml));
  const again = await page.request.get(`/api/download/${fileId}`, { maxRedirects: 0 });
  expect(again.status()).toBe(303);
  const counts = async () => (await serviceClient().from("templates").select("download_count, view_count").eq("id", templateId).single()).data;
  expect((await counts())?.download_count).toBe(1);
  await expect.poll(async () => (await counts())?.view_count).toBeGreaterThanOrEqual(1);

  // Comment.
  await page.reload();
  await page.getByLabel("Add a comment…").click();
  await page.getByLabel("Add a comment…").fill("Does this work with the latest version?");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Does this work with the latest version?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "1 comment" })).toBeVisible();

  // Follow the creator; their upload appears in the Following feed.
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Following" })).toBeVisible();
  await expect(page.getByText("1 follower", { exact: true })).toBeVisible();
  await page.goto("/feed");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();

  // Rate and save.
  await page.goto(`/t/${slug}`);
  await page.getByLabel("4★").check();
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();
  await page.getByRole("button", { name: "☆ Save" }).click();
  await expect(page.getByRole("button", { name: "★ Saved" })).toBeVisible();
  await page.goto("/library");
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();

  // The creator replies.
  await logout(page);
  await login(page, creatorEmail, `/t/${slug}`);
  await page.getByRole("button", { name: "Reply" }).first().click();
  await page.getByLabel("Add a reply…").fill("Yes, tested on 1.140.");
  await page.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(page.getByText("Yes, tested on 1.140.")).toBeVisible();
});

test("replacing a published file takes it offline until the new file is scanned", async ({ page }) => {
  await login(page, creatorEmail, "/dashboard");
  await page.goto(`/dashboard/submissions/${templateId}`);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Replace" }).first().click();
  await page
    .getByLabel("Choose a template file")
    .setInputFiles({ name: "workspace.xml", mimeType: "text/xml", buffer: Buffer.from(xml.toString().replace("ES", "NQ")) });
  await expect(page.getByText("Validated and queued for a malware scan.")).toBeVisible();
  expect(await status()).toBe("pending");
  const dl = await page.request.get(`/api/download/${fileId}`, { headers: { accept: "application/json" }, maxRedirects: 0 });
  expect(dl.status()).toBeGreaterThanOrEqual(400);
});

import { expect, test } from "@playwright/test";

test("create a schema, preview it, download CSV and serve it as a mock", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "New schema" }).click();

  await page.getByLabel("Name", { exact: true }).fill("People");
  await expect(page.getByLabel("Slug")).toHaveValue("people");

  const rows = page.locator("section.preview tbody tr");
  await expect(rows).toHaveCount(10);
  await expect(page.locator("section.preview")).toContainText("@");

  // Generating works before the schema is saved, like Mockaroo.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate Data" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("people.csv");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/#\/schemas\/[0-9a-f-]{36}$/);

  await page.getByLabel(/Serve this schema/).click(); // state flips after the server round trip, so check() would fail its immediate verify
  await expect(page.getByLabel(/Serve this schema/)).toBeChecked();
  await expect.poll(async () => (await request.get("/mock/people/1")).status()).toBe(200);
  const body = await (await request.get("/mock/people?pageSize=5")).json();
  expect(body.total).toBe(1000);
  expect(body.data).toHaveLength(5);
});

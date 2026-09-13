import { randomBytes, randomUUID } from "node:crypto";
import { readFile, rm, mkdir, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { prepareAccounts } from "./prepare.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
it("writes only a new ignored private batch directory with separate admin delivery and no manifest plaintext", async () => {
  const password = randomBytes(20).toString("hex"),
    relative = `local-private-accounts/test-${randomUUID()}`,
    out = resolve(root, relative);
  try {
    await prepareAccounts(relative, password);
    const manifest = await readFile(resolve(out, "manifest.json"), "utf8");
    expect(JSON.parse(manifest).accounts).toHaveLength(31);
    expect(manifest).not.toContain(password);
    const teachers = await readFile(resolve(out, "teachers.tsv"), "utf8"),
      admin = await readFile(resolve(out, "administrator.tsv"), "utf8");
    expect(teachers.trim().split("\n")).toHaveLength(31);
    expect(admin.trim().split("\n")).toHaveLength(2);
    expect(teachers).toContain(password);
    expect(admin).toContain(password);
    expect(teachers).not.toContain("账号管理员");
    expect(await readFile(resolve(out, "README.txt"), "utf8")).toContain(
      "待云端应用",
    );
    await expect(prepareAccounts(relative, password)).rejects.toThrow(
      "output_exists",
    );
    expect(await readFile(resolve(out, "manifest.json"), "utf8")).toBe(
      manifest,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
it("rejects tracked/outside directories, absent initial password and symlink escape", async () => {
  await expect(
    prepareAccounts("platform-api/src", "synthetic-password"),
  ).rejects.toThrow("private_output_required");
  await expect(
    prepareAccounts("../local-private-accounts/x", "synthetic-password"),
  ).rejects.toThrow("private_output_required");
  await expect(
    prepareAccounts(`local-private-accounts/test-${randomUUID()}`, ""),
  ).rejects.toThrow("invalid_initial_password");
  const target = resolve(root, "platform-api/local-auth-data", randomUUID()),
    link = resolve(root, "local-private-accounts", `link-${randomUUID()}`);
  await mkdir(target, { recursive: true });
  try {
    await symlink(target, link, "junction");
    await expect(
      prepareAccounts(resolve(link, "out"), "synthetic-password"),
    ).rejects.toThrow("private_output_required");
  } finally {
    await rm(link, { force: true, recursive: true });
    await rm(target, { recursive: true, force: true });
  }
});

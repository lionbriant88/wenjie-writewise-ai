import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import { buildManifest } from "./manifest.js";
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);
export async function prepareAccounts(
  out: string,
  password: string,
): Promise<void> {
  const privateRoot = resolve(repoRoot, "local-private-accounts");
  const output = resolve(repoRoot, out);
  // A fresh immediate child keeps symlinks and path traversal out of delivery paths.
  if (dirname(output) !== privateRoot) throw Error("private_output_required");
  if (
    typeof password !== "string" ||
    password.length < 6 ||
    password.length > 256 ||
    /[\r\n\t\0]/.test(password)
  )
    throw Error("invalid_initial_password");
  try {
    await run("git", [
      "-C",
      repoRoot,
      "check-ignore",
      "--quiet",
      "--",
      relative(repoRoot, resolve(output, "manifest.json")),
    ]);
  } catch {
    throw Error("private_output_required");
  }
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  if (resolve(await realpath(privateRoot)) !== privateRoot)
    throw Error("private_output_required");
  try {
    await mkdir(output, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw Error("output_exists");
    throw error;
  }
  const save = (name: string, value: string) =>
    writeFile(resolve(output, name), value, { flag: "wx", mode: 0o600 });
  // If preparation is interrupted, this marker identifies a partial directory; never overwrite it.
  await save(
    "README.txt",
    "待云端应用。仅生成本地私密分发资料，不代表云账号已创建。\nmanifest.json 无明文密码；teachers.tsv 和 administrator.tsv 含凭据，请分别分发。\n仅当四个文件齐全时才可应用；若中断请重新选择一个新输出目录。\n",
  );
  const manifest = await buildManifest(password);
  const header = "显示名\t账号\t初始密码\n";
  const row = (a: (typeof manifest.accounts)[number]) =>
    `${a.displayName}\t${a.username}\t${password}\n`;
  await save(
    "teachers.tsv",
    header +
      manifest.accounts
        .filter((a) => a.role === "teacher")
        .map(row)
        .join(""),
  );
  await save(
    "administrator.tsv",
    header +
      manifest.accounts
        .filter((a) => a.role === "admin")
        .map(row)
        .join(""),
  );
  // Manifest is published last so a partial delivery export cannot be accidentally applied.
  await save("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
}

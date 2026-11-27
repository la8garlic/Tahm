import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// 读取 Cargo 实际产物路径，使自定义 target 目录也能更新同一个启动入口。
const output = execFileSync(
  "cargo",
  ["build", "--release", "--locked", "--bin", "Tahm", "--message-format=json-render-diagnostics"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 },
);
const artifact = output
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line))
  .find(({ reason, target, executable }) =>
    reason === "compiler-artifact" && target.name === "Tahm" && executable
  );
if (!artifact) throw new Error("Cargo 没有返回 Tahm 可执行文件。");

const name = basename(artifact.executable);
const staging = mkdtempSync(resolve(".tahm-release-"));
const temporary = join(staging, name);
try {
  // 同卷替换，复制中断时根目录中的上一版仍可启动。
  copyFileSync(artifact.executable, temporary);
  renameSync(temporary, resolve(name));
  console.log(`桌面程序已更新：${name}`);
} finally {
  rmSync(temporary, { force: true });
  rmdirSync(staging);
}

import { locale } from "./i18n";

const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
/** @param {number} size */
export function bytes(size) {
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toLocaleString(locale(), { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

/** @param {string} path */
export function basename(path) {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/")) + 1);
}

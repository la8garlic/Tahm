"""Package the Windows portable executable with notices from its locked dependencies."""
import hashlib
import json
from pathlib import Path
import subprocess
import tomllib
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
TARGET = "x86_64-pc-windows-msvc"


def command(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding="utf-8").strip()


def legal_files(folder):
    for file in sorted(folder.rglob("*")):
        if file.is_file() and file.name.lower().startswith(("license", "licence", "copying", "notice", "copyright")):
            yield file


def cargo_notices(bundle):
    data = json.loads(command("cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", TARGET))
    packages = {p["id"]: p for p in data["packages"]}
    nodes = {n["id"]: n for n in data["resolve"]["nodes"]}
    pending = [data["resolve"]["root"]]
    seen = set()
    index = []
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        pending.extend(dep["pkg"] for dep in nodes[key]["deps"] if any(k["kind"] is None for k in dep["dep_kinds"]))
        if key == data["resolve"]["root"]:
            continue
        pkg = packages[key]
        name, version = pkg["name"], pkg["version"]
        folder = Path(pkg["manifest_path"]).parent
        dest = f"licenses/cargo/{name}-{version}"
        files = list(legal_files(folder))
        if files:
            for file in files:
                bundle.write(file, f"{dest}/{file.relative_to(folder).as_posix()}")
        else:
            fallback = "webview2" if name.startswith("webview2-com") else name
            bundle.write(ROOT / "licenses" / f"{fallback}.txt", f"{dest}/LICENSE.txt")
        index.append(f"{name} {version} | {pkg['license'] or 'see included license'} | https://crates.io/crates/{name}/{version}")
    bundle.writestr("licenses/Cargo-sources.txt", "\n".join(sorted(index)) + "\n")


def package():
    version = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["package"]["version"]
    for filename in ("tauri.conf.json", "package.json", "package-lock.json"):
        if json.loads((ROOT / filename).read_text(encoding="utf-8"))["version"] != version:
            raise ValueError(f"Version mismatch: {filename}")
    out = ROOT / "release"
    out.mkdir(exist_ok=True)
    archive = out / f"Tahm-v{version}-windows-x64.zip"
    # Cargo normalizes some source mtimes to 1970, before the first ZIP timestamp.
    with ZipFile(archive, "w", ZIP_DEFLATED, strict_timestamps=False) as bundle:
        for name in ("Tahm.exe", "LICENSE", "NOTICE"):
            bundle.write(ROOT / name, name)
        for file in sorted([*ROOT.glob("*.md"), *(ROOT / "docs").rglob("*.md")]):
            bundle.write(file, file.relative_to(ROOT))
        bundle.write(ROOT / "web/public/licenses/MiSans.pdf", "web/public/licenses/MiSans.pdf")
        bundle.write(ROOT / "web/public/licenses/MiSans.pdf", "licenses/MiSans.pdf")
        lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
        for path, pkg in lock["packages"].items():
            if path and not pkg.get("dev"):
                files = list(legal_files(ROOT / path))
                if not files:
                    raise ValueError(f"Missing notices: {path}")
                for file in files:
                    bundle.write(file, f"licenses/npm/{path.removeprefix('node_modules/')}-{pkg['version']}/{file.relative_to(ROOT / path).as_posix()}")
        cargo_notices(bundle)
        rust = Path(command("rustc", "--print", "sysroot")) / "share/doc/rust"
        bundle.write(rust / "COPYRIGHT-library.html", "licenses/rust/COPYRIGHT-library.html")
        for file in (rust / "licenses").iterdir():
            bundle.write(file, "licenses/rust/licenses/" + file.name)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    (out / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(archive.name, digest)


if __name__ == "__main__":
    package()

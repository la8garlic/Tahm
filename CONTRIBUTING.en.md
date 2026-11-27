# Contributing

[简体中文](CONTRIBUTING.md) · [Project overview](README.en.md)

## Build on Windows x64

Install Visual Studio 2022 Desktop development with C++, the Windows SDK, WebView2, CMake, the Rust MSVC toolchain, Node.js 24.12.0 and Python 3.12. CI uses Rust 1.100.0. Run the following in PowerShell at the repository root.

```powershell
rustup toolchain install 1.100.0 --profile minimal --component rustfmt --component clippy
$env:RUSTUP_TOOLCHAIN = '1.100.0'
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install --only-binary=:all: -r scripts/requirements.txt
.\.venv\Scripts\python scripts/prepare-font.py
npm ci
cargo fmt --check
npm run build:desktop
cargo clippy --release --locked -- -D warnings
```

Font preparation downloads Xiaomi's approximately 228 MB archive on first use. To use an existing official download, pass `--archive C:\Downloads\MiSans.zip`. The script checks both the input TTF and output WOFF2 digests and reuses a verified local font. Read the [font agreement](web/public/licenses/MiSans.pdf). Keep generated fonts, executables, scan reports and personal settings out of commits.

## Send a change

Branch from current `main` and open a focused PR. Describe the user task, behavior changes and commands you actually ran. Update both UI languages and preserve user-supplied filenames. For changes to recycling, hard links, reparse points or duplicate detection, use a disposable fixture and record the before-and-after result. Leave the system Recycle Bin contents intact during verification.

Use public issues for feature discussions and redacted bug reports. Follow the [security policy](SECURITY.en.md) for unintended filesystem operations or credential exposure. Merges require a passing Windows x64 check and resolved review conversations.

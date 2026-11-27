# Tahm · Disk Space Analyzer

[简体中文](README.md) · [Download](https://github.com/la8garlic/Tahm/releases/latest) · [Report a vulnerability](SECURITY.en.md)

Tahm is a Windows x64 desktop application for understanding disk usage. Scan a drive or folder, inspect forgotten directories and estimate how much space a selection could free before sending it to the Recycle Bin. The core analysis runs locally and works offline.

## Install and run

1. Download the portable ZIP and `SHA256SUMS.txt` from the same [release](https://github.com/la8garlic/Tahm/releases).
2. For v0.8.0, run `Get-FileHash .\Tahm-v0.8.0-windows-x64.zip -Algorithm SHA256` and compare the hexadecimal digest with the checksum file.
3. Extract the ZIP and start `Tahm.exe`. Install the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if it is missing. The public executable has no Authenticode signature.
4. Choose **English** or **中文** in the title bar. Tahm saves the preference. To open a specific folder, run `.\Tahm.exe "D:\Example folder"`.

## Explore and reclaim space

- Switch the treemap between logical size and allocated space. Selecting a tile locates its row, and selecting a row locates its tile. Right-click a tile to open its folder.
- Ctrl-click individual items or Shift-click a range. Selections carry across folders. Totals collapse nested items and count shared data once. If a hard link survives outside the selection, its data stays allocated.
- Explore extensions, large or old folders, identical contents and changes since the previous scan. Review the cleanup queue and confirm before moving anything to the Windows Recycle Bin. Changed or inaccessible entries have individual outcomes.
- Reclamation takes effect when the system Recycle Bin is emptied. The estimate covers verifiable primary file data streams. Directory metadata, unrelated writes and existing bin contents can affect the final free-space figure.

## Privacy and optional models

Tahm keeps up to eight recent scan summaries locally. Clear them in Scan center. Exported JSON may contain absolute paths. Redact reports before sharing. An ordinary scan reads filesystem metadata. The explicit identical-file comparison reads candidate file contents.

The folder explanation dialog previews evidence such as names, sizes, timestamps and local rule findings. Sending the summary contacts your chosen provider. Supported options include DeepSeek, OpenAI, Anthropic and compatible services on loopback. Enter a key in the dialog or set `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` before launch. Keep keys out of source control. Verify backups and dependencies before acting on model suggestions.

## Build and contribute

Tahm uses Rust, Tauri 2, React, TypeScript and Vite. See the [contributor guide](CONTRIBUTING.en.md) for Windows prerequisites, font preparation and build commands. Read the [security policy](SECURITY.en.md), [code of conduct](CODE_OF_CONDUCT.en.md) and [maintainer guide](docs/maintenance.en.md) before making a release.

## Licensing

Project code uses [Apache-2.0](LICENSE). Xiaomi MiSans VF has its [own agreement](web/public/licenses/MiSans.pdf). The build verifies the official input and embeds the full font for offline use. The portable ZIP includes dependency notices and sources under `licenses/`. See [NOTICE](NOTICE).

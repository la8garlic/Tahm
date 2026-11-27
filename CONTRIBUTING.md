# 贡献指南

[English](CONTRIBUTING.en.md) · [项目主页](README.md)

## 本地构建

准备 Windows x64、Visual Studio 2022 C++ 桌面开发工具和 Windows SDK、WebView2、CMake、Rust MSVC 工具链、Node.js 24.12.0 和 Python 3.12。CI 使用 Rust 1.100.0。以下命令在仓库根目录的 PowerShell 中运行。

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

字体准备首次从小米下载约 228 MB 的 ZIP。已有官方文件时可传入 `--archive C:\Downloads\MiSans.zip`。脚本检查原始 TTF 和完整 WOFF2 的 SHA-256；再次构建复用已校验的文件。字体协议见 [MiSans](web/public/licenses/MiSans.pdf)。生成的字体、EXE、扫描报告和个人配置不应提交。

## 提交改动

从最新 `main` 建分支，围绕一个问题提交 PR。说明使用场景、受影响的行为和实际执行命令。界面文案同步维护中英文；文件名与路径应按原样显示。涉及回收站、硬链接、重解析点或重复文件的改动，请使用自己创建的临时目录，并记录操作前后的实际结果。请勿清空系统回收站来验证功能。

公开 issue 适合功能讨论和脱敏的普通缺陷。涉及意外文件操作、凭据泄露或安全边界的问题请走[私密报告](SECURITY.md)。维护者通过 PR 合并，Windows x64 检查必须通过，所有评审讨论须解决。

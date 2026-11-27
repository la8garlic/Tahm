# 维护与发布

[English](maintenance.en.md) · [返回首页](../README.md)

## 接收变更

从最新的 `main` 创建分支并提交 PR。Windows x64 检查使用锁文件构建桌面程序，并运行类型检查、Rust 格式检查和 Clippy。检查与最新主分支同步、审查讨论解决后，使用 squash 合并。单维护者阶段批准数设为零。增加第二位长期维护者时，可将最低批准数提高为一，并启用代码所有者审查。

`.github/rulesets/` 保存线上规则的定义。主分支禁止强推和删除。版本标签仅允许仓库管理员创建，创建后禁止更新和删除。更改文件后，管理员还须在 GitHub 的 Settings → Rules → Rulesets 更新对应规则，核对实际执行状态。个人账号启用双重验证，将恢复码保存在账号之外。[GitHub 规则集](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

## 处理依赖和安全报告

在 Security 中查看 Dependabot 和密钥扫描告警。依赖更新先审阅上游变更和许可，再合并通过检查的 PR。工作流使用只读令牌，第三方贡献的构建不需要模型密钥。更新 GitHub Action 时核对官方发布提交的完整 SHA。若密钥泄露，先在对应服务撤销并轮换，再清理公开内容。按[安全政策](../SECURITY.md)在私密报告中处理可能影响用户文件的问题。[GitHub Actions 安全指南](https://docs.github.com/en/actions/reference/security/secure-use)

## 发布 Windows 便携版

1. 用 PR 同步更新 Cargo、npm、Tauri 版本、锁文件和两种语言的发行说明。检查图标、字体及第三方许可。仅用自行创建的临时目录复核清理功能。
2. 合并后记录 `main` 的完整提交 SHA，从对应的成功 Windows 工作流下载 `Tahm-windows-x64` 构件。PR 构建不作为发布来源。
3. 用 `Get-FileHash -Algorithm SHA256` 比对 ZIP 和 `SHA256SUMS.txt`。解压后检查程序版本、MiSans 协议、第三方许可，并启动程序。
4. 在该提交上创建带注释的 `vX.Y.Z` 标签并单独推送。创建 Release 草稿，上传本次构建的 ZIP、校验文件，加入中英文发行说明。
5. 核对标签、资产名称和摘要后再发布。不可变发行版锁定已发布资产和标签。发现发行错误时发新版本，安全问题另行发布公告。发布后从公开地址下载并再次比对摘要。[GitHub 发布指南](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

首个公开版本从已审查源码快照开始。维护者应分别备份历史开发记录及账号恢复资料，并避免将个人扫描报告、字体原始包和本地配置推送到公开仓库。

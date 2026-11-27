# Maintaining and releasing Tahm

[简体中文](maintenance.zh-CN.md) · [Project overview](../README.en.md)

## Accepting changes

Branch from current `main` and open a PR. The Windows x64 check builds the desktop application from lockfiles and runs TypeScript checks, Rust formatting and Clippy. Update the branch, resolve review conversations and squash merge after the check passes. Required approvals are set to zero for a single maintainer. With a second ongoing maintainer, consider requiring one approval and code owner review.

The definitions in `.github/rulesets/` correspond to the live GitHub rules. Main blocks force pushes and deletion. Repository administrators can create version tags. Those tags are protected against changes and deletion. After editing a definition, update its live counterpart in Settings → Rules → Rulesets and verify enforcement. Enable two-factor authentication on your personal account and store recovery codes separately. [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)

## Dependencies and security reports

Review Dependabot and secret scanning alerts in Security. Check upstream changes and licenses before merging passing dependency updates. Workflows use read-only tokens and build external contributions without model credentials. Verify the full commit SHA against the official release when updating an Action. Revoke and rotate exposed credentials at the provider before cleaning up public content. Handle risks to user files privately under the [security policy](../SECURITY.en.md). [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

## Publishing the portable Windows release

1. Open a PR updating Cargo, npm and Tauri versions, lockfiles and both sets of release notes. Review artwork, font and dependency licenses. Use disposable files for cleanup verification.
2. Record the full commit SHA after merge. Download the `Tahm-windows-x64` artifact from the successful Windows workflow on that exact main commit.
3. Compare the ZIP digest from `Get-FileHash -Algorithm SHA256` with `SHA256SUMS.txt`. Extract the archive, check the executable version, font agreement and dependency notices, and launch the app.
4. Create an annotated `vX.Y.Z` tag on that commit and push the individual tag. Draft a Release with the ZIP, checksum file and bilingual notes.
5. Confirm the tag, asset names and hashes before publishing. Published immutable releases lock their assets and tag. Ship corrections in a new version and issue an advisory for security fixes. Download the published asset and verify its digest again. [GitHub release guide](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)

The first public version starts from a reviewed source snapshot. Keep separate backups of development history and account recovery details. Keep personal scan reports, original font archives and local configuration outside the public repository.

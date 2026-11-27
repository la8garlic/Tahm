# Security policy

[简体中文](SECURITY.md)

Security fixes target the latest public release. Use [GitHub private vulnerability reporting](https://github.com/la8garlic/Tahm/security/advisories/new). Include the release version, Windows version, expected and observed behavior and minimal steps using files you created for the report.

Relevant areas include unintended file moves, path and reparse-point handling, hard-link accounting, model metadata and credentials, build infrastructure and release artifacts. Use invented paths and remove personal files, scan history and service credentials. Revoke and rotate any exposed key with its provider.

Maintainers will work with the reporter to establish impact, develop a fix and coordinate disclosure. Affected versions will be documented in release notes or a security advisory. Obtain downloads from this repository's Releases page and verify SHA-256.

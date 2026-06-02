# TeamSync Release Process

TeamSync source code stays private in `tarunshetty125/teamsync-build`.
Public auto-update assets are published to GitHub Releases in `tarunshetty125/TeamSync`.

The public repository must contain only distributable release assets. Do not push source code, generated source archives from the private repo, or private build logs to `tarunshetty125/TeamSync`.

## Release Feed

Electron Builder writes the updater config into packaged apps as `app-update.yml`.
The configured provider is GitHub:

```yaml
provider: github
owner: tarunshetty125
repo: TeamSync
```

Runtime updater discovery uses public GitHub Releases from `tarunshetty125/TeamSync`.

## Channels

| Version | Channel | Required manifests | GitHub release type |
| --- | --- | --- | --- |
| `2.5.1` | `latest` | `latest.yml`, `latest-mac.yml` | Release |
| `2.6.0-beta.1` | `beta` | `beta.yml`, `beta-mac.yml` | Pre-release |

The Electron main process derives the runtime update channel from `app.getVersion()`:

```ts
2.5.1        -> latest
2.5.1-beta.1 -> beta
```

CI also passes the channel explicitly to Electron Builder through `scripts/create-release-builder-config.js`.
Do not rely on implicit GitHub channel detection.

## Canonical Release Workflow

Releases are created by pushing a private source tag:

```bash
git tag v2.5.1
git push origin v2.5.1
```

For beta:

```bash
git tag v2.6.0-beta.1
git push origin v2.6.0-beta.1
```

The tag version must match `package.json` exactly without the `v` prefix. For example, tag `v2.5.1` requires:

```json
"version": "2.5.1"
```

The release workflow:

1. Validates the tag and package version.
2. Resolves `latest` or `beta`.
3. Builds macOS DMG and ZIP artifacts.
4. Builds Windows installer artifacts.
5. Generates update manifests and blockmaps.
6. Creates or reuses the matching public GitHub Release in `tarunshetty125/TeamSync`.
7. Uploads release assets with `--clobber` for safe workflow retries.

## Required Assets

Stable releases must publish:

```text
latest.yml
latest-mac.yml
TeamSync-Setup-${version}.exe
TeamSync-Setup-${version}.exe.blockmap
TeamSync-${version}.dmg
TeamSync-${version}.dmg.blockmap
TeamSync-${version}-arm64.dmg
TeamSync-${version}-arm64.dmg.blockmap
TeamSync-${version}-mac.zip
TeamSync-${version}-mac.zip.blockmap
TeamSync-${version}-arm64-mac.zip
TeamSync-${version}-arm64-mac.zip.blockmap
```

Beta releases replace the stable manifests with:

```text
beta.yml
beta-mac.yml
```

Portable Windows executables may also be uploaded as manual-install assets, but the updater manifests must point at the NSIS setup installer.

## Required Secret

Store this secret only in the private source repository:

```text
RELEASE_REPO_TOKEN
```

Use a fine-grained GitHub token or GitHub App token scoped only to `tarunshetty125/TeamSync` with:

```text
Contents: Read and Write
Metadata: Read
```

## Migration Note

Installed builds that point to `tarunshetty125/teamsync-build` cannot reliably migrate through auto-update because that feed is private or unreachable.

The first public release in `tarunshetty125/TeamSync` becomes the new baseline. Users install that version manually; future builds update from the public feed.

## Validation

Before publishing:

```bash
npm run typecheck:electron
```

After publishing a stable release, these URLs must return HTTP 200 without authentication:

```text
https://github.com/tarunshetty125/TeamSync/releases/latest
https://github.com/tarunshetty125/TeamSync/releases/download/v${version}/latest.yml
https://github.com/tarunshetty125/TeamSync/releases/download/v${version}/latest-mac.yml
```

For beta, validate the tag-specific beta manifests:

```text
https://github.com/tarunshetty125/TeamSync/releases/download/v${version}/beta.yml
https://github.com/tarunshetty125/TeamSync/releases/download/v${version}/beta-mac.yml
```

Runtime smoke test:

1. Install a TeamSync build that points to `tarunshetty125/TeamSync`.
2. Publish a higher version.
3. Check for updates.
4. Confirm update detection succeeds.
5. Confirm download succeeds.
6. Confirm version increases after install or manual macOS replacement.
7. Confirm user data, auth, and license state persist.

/**
 * Ensures all sqlite-vec platform packages are present in node_modules,
 * even when the current CPU doesn't match (e.g. building x64 release on arm64).
 * npm skips optional deps with non-matching "cpu" constraints, so we force-install them.
 *
 * Cross-platform: uses os.tmpdir() instead of /tmp, and PowerShell extraction on Windows.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SQLITE_VEC_VERSION = '0.1.7-alpha.2';

// Platform packages — install all packages for the current OS so both
// architectures are available for universal/cross-arch builds.
const platformPackages = {
  darwin: [
    'sqlite-vec-darwin-arm64',
    'sqlite-vec-darwin-x64',
  ],
  win32: [
    'sqlite-vec-windows-x64',
  ],
  linux: [
    'sqlite-vec-linux-x64',
  ],
};

const packages = platformPackages[os.platform()] || [];

if (packages.length === 0) {
  console.log(`[ensure-sqlite-vec] No sqlite-vec packages defined for platform "${os.platform()}", skipping.`);
  process.exit(0);
}

const tmpDir = os.tmpdir();

for (const pkg of packages) {
  const pkgDir = path.join(__dirname, '..', 'node_modules', pkg);
  if (fs.existsSync(pkgDir)) {
    console.log(`[ensure-sqlite-vec] ${pkg} already present, skipping.`);
    continue;
  }

  console.log(`[ensure-sqlite-vec] ${pkg} missing — fetching...`);
  try {
    // Use npm pack to download the tarball, then extract it into node_modules.
    // --pack-destination uses the OS temp directory (cross-platform safe).
    const tarball = execSync(`npm pack ${pkg}@${SQLITE_VEC_VERSION} --pack-destination "${tmpDir}"`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
    }).trim();
    const tarPath = path.join(tmpDir, tarball);

    fs.mkdirSync(pkgDir, { recursive: true });

    if (os.platform() === 'win32') {
      // Windows: use PowerShell to extract .tgz (tar may not be available on older Windows 10)
      execSync(
        `powershell -NoProfile -Command "tar xzf '${tarPath}' --strip-components=1 -C '${pkgDir}'"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(`tar xzf "${tarPath}" --strip-components=1 -C "${pkgDir}"`, { stdio: 'inherit' });
    }

    fs.unlinkSync(tarPath);
    console.log(`[ensure-sqlite-vec] ${pkg} installed successfully.`);
  } catch (e) {
    console.warn(`[ensure-sqlite-vec] Warning: could not install ${pkg}:`, e.message);
  }
}

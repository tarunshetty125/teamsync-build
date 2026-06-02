#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const RELEASE_OWNER = 'tarunshetty125';
const RELEASE_REPO = 'TeamSync';
const VALID_CHANNELS = new Set(['latest', 'beta']);
const VALID_RELEASE_TYPES = new Set(['release', 'prerelease']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`[release-builder-config] ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const channel = args.channel || process.env.UPDATE_CHANNEL || 'latest';
const releaseType = args['release-type'] || process.env.RELEASE_TYPE || (channel === 'beta' ? 'prerelease' : 'release');
const outputPath = args.out || process.env.RELEASE_BUILDER_CONFIG_OUT;

if (!VALID_CHANNELS.has(channel)) {
  fail(`Unsupported channel "${channel}". Expected one of: ${Array.from(VALID_CHANNELS).join(', ')}`);
}

if (!VALID_RELEASE_TYPES.has(releaseType)) {
  fail(`Unsupported release type "${releaseType}". Expected one of: ${Array.from(VALID_RELEASE_TYPES).join(', ')}`);
}

const repoRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

if (!packageJson.build || typeof packageJson.build !== 'object') {
  fail('package.json is missing a build configuration');
}

const buildConfig = JSON.parse(JSON.stringify(packageJson.build));
const existingPublish = Array.isArray(buildConfig.publish) && buildConfig.publish.length > 0
  ? buildConfig.publish[0]
  : { provider: 'github' };

buildConfig.publish = [
  {
    ...existingPublish,
    provider: 'github',
    owner: RELEASE_OWNER,
    repo: RELEASE_REPO,
    channel,
    releaseType,
  },
];

const serialized = `${JSON.stringify(buildConfig, null, 2)}\n`;

if (outputPath) {
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  console.log(`[release-builder-config] wrote ${outputPath} for ${channel}/${releaseType}`);
} else {
  process.stdout.write(serialized);
}

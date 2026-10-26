import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Release Please uses the component-prefixed tag dbux-vX.Y.Z; also accept vX.Y.Z for manual retries.
export const SEMVER_TAG_PATTERN = /^v(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:[.](?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:[+]([0-9A-Za-z-]+(?:[.][0-9A-Za-z-]+)*))?$/;

export function getCurrentVersions(rootDir = process.cwd()) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const tauriConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoText = fs.readFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), 'utf8');
  const packageStart = cargoText.indexOf('[package]');

  if (packageStart < 0) {
    throw new Error('src-tauri/Cargo.toml is missing the [package] section.');
  }

  const afterPackageHeader = cargoText.slice(packageStart + '[package]'.length);
  const nextSectionAt = afterPackageHeader.indexOf('\n[');
  const packageSection = nextSectionAt >= 0 ? afterPackageHeader.slice(0, nextSectionAt) : afterPackageHeader;
  const versionLine = packageSection.split('\n').map((line) => line.trim()).find((line) => line.startsWith('version') && line.includes('='));
  const cargoVersion = versionLine?.split('"')[1];

  return {
    'package.json': packageJson.version,
    'src-tauri/tauri.conf.json': tauriConfig.version,
    'src-tauri/Cargo.toml': cargoVersion,
  };
}

export function normalizeReleaseTag(tag) {
  if (typeof tag !== 'string') {
    throw new Error('Release tag must be a string.');
  }

  const semverTag = tag.startsWith('dbux-v') ? tag.slice('dbux-'.length) : tag;
  if (!SEMVER_TAG_PATTERN.test(semverTag)) {
    throw new Error('Release tag must be a strict SemVer tag in vMAJOR.MINOR.PATCH or dbux-vMAJOR.MINOR.PATCH form (including valid prerelease/build metadata). Received: ' + tag);
  }

  return semverTag;
}

export function validateReleaseVersion(tag, versions) {
  const semverTag = normalizeReleaseTag(tag);
  const tagVersion = semverTag.slice(1);
  for (const [file, version] of Object.entries(versions)) {
    if (typeof version !== 'string' || version !== tagVersion) {
      throw new Error(file + ' version is "' + String(version ?? 'missing') + '"; expected ' + tagVersion + ' to match ' + tag + '.');
    }
  }

  return tagVersion;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const tag = process.argv[2];
    if (!tag) {
      throw new Error('Usage: node scripts/validate-release-version.mjs dbux-vMAJOR.MINOR.PATCH');
    }
    validateReleaseVersion(tag, getCurrentVersions());
    console.log('Validated ' + tag + '; package.json, Tauri, and Cargo versions are synchronized.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

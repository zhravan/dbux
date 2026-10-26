import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SEMVER_TAG_PATTERN = /^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$/;

export function getCurrentVersions(rootDir = process.cwd()) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const tauriConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cargoText = fs.readFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), 'utf8');
  const packageStart = cargoText.indexOf('[package]');

  if (packageStart < 0) {
    throw new Error('src-tauri/Cargo.toml is missing the [package] section.');
  }

  const packageSection = cargoText.slice(packageStart + '[package]'.length).split(/^\\[/m)[0];
  const cargoVersion = packageSection.match(/^version\\s*=\\s*"([^"]+)"/m)?.[1];

  return {
    'package.json': packageJson.version,
    'src-tauri/tauri.conf.json': tauriConfig.version,
    'src-tauri/Cargo.toml': cargoVersion,
  };
}

export function validateReleaseVersion(tag, versions) {
  if (typeof tag !== 'string' || !SEMVER_TAG_PATTERN.test(tag)) {
    throw new Error('Release tag must be a strict SemVer version with a v prefix (for example v1.2.3). Received: ' + String(tag));
  }

  const tagVersion = tag.slice(1);
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
      throw new Error('Usage: node scripts/validate-release-version.mjs vMAJOR.MINOR.PATCH');
    }
    const version = validateReleaseVersion(tag, getCurrentVersions());
    console.log('Validated ' + tag + '; package.json, Tauri, and Cargo versions are synchronized.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

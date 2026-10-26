import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentVersions, validateReleaseVersion } from './validate-release-version.mjs';

test('the repository versions match its current SemVer tag', () => {
  const versions = getCurrentVersions();
  assert.equal(validateReleaseVersion('v' + versions['package.json'], versions), versions['package.json']);
});

test('accepts valid stable, prerelease, and build-metadata tags', () => {
  const versions = { 'package.json': '1.2.3', 'src-tauri/tauri.conf.json': '1.2.3', 'src-tauri/Cargo.toml': '1.2.3' };
  assert.equal(validateReleaseVersion('v1.2.3', versions), '1.2.3');
  assert.equal(validateReleaseVersion('v1.2.3-rc.1', { ...versions, 'package.json': '1.2.3-rc.1', 'src-tauri/tauri.conf.json': '1.2.3-rc.1', 'src-tauri/Cargo.toml': '1.2.3-rc.1' }), '1.2.3-rc.1');
  assert.equal(validateReleaseVersion('v1.2.3+build.5', { ...versions, 'package.json': '1.2.3+build.5', 'src-tauri/tauri.conf.json': '1.2.3+build.5', 'src-tauri/Cargo.toml': '1.2.3+build.5' }), '1.2.3+build.5');
});

test('rejects malformed SemVer tags', () => {
  const versions = { 'package.json': '1.2.3', 'src-tauri/tauri.conf.json': '1.2.3', 'src-tauri/Cargo.toml': '1.2.3' };
  for (const tag of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-01', 'v1.2.3-']) {
    assert.throws(() => validateReleaseVersion(tag, versions), /strict SemVer/);
  }
});

test('rejects a version mismatch across the application manifests', () => {
  const versions = { 'package.json': '1.2.3', 'src-tauri/tauri.conf.json': '1.2.2', 'src-tauri/Cargo.toml': '1.2.3' };
  assert.throws(() => validateReleaseVersion('v1.2.3', versions), /tauri.conf.json version is "1.2.2"/);
});

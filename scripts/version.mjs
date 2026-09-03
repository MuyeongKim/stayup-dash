#!/usr/bin/env node
/* Copyright 2026 MuyeongKim · Licensed under the Apache License, Version 2.0 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..');
const versionPath = join(rootDir, 'VERSION');
const appPath = join(rootDir, 'stayup-dash.html');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const appVersionPattern = /^var APP_VERSION = '((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))';$/gm;

function fail(message) {
  console.error(`버전 처리 실패: ${message}`);
  process.exit(1);
}

function parseVersion(value) {
  const match = versionPattern.exec(value);
  if (!match) fail(`VERSION 값이 SemVer 형식이 아닙니다: ${value}`);
  return match.slice(1).map(Number);
}

function loadState() {
  const version = readFileSync(versionPath, 'utf8').trim();
  parseVersion(version);

  const appSource = readFileSync(appPath, 'utf8');
  const matches = [...appSource.matchAll(appVersionPattern)];
  if (matches.length !== 1) {
    fail(`stayup-dash.html의 APP_VERSION 선언은 정확히 1개여야 합니다. 현재 ${matches.length}개입니다.`);
  }
  if (matches[0][1] !== version) {
    fail(`VERSION(${version})과 APP_VERSION(${matches[0][1]})이 다릅니다.`);
  }
  return { version, appSource };
}

function nextVersion(current, type) {
  const parts = parseVersion(current);
  if (type === 'major') return `${parts[0] + 1}.0.0`;
  if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  if (type === 'patch') return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  fail(`증가 종류는 major, minor, patch 중 하나여야 합니다: ${type}`);
}

const command = process.argv[2] || 'check';
const state = loadState();

if (command === 'check') {
  console.log(`v${state.version} 동기화 확인`);
  process.exit(0);
}

if (command !== 'bump') fail(`지원하지 않는 명령입니다: ${command}`);

const type = process.argv[3] || 'patch';
const next = nextVersion(state.version, type);
const before = `var APP_VERSION = '${state.version}';`;
const after = `var APP_VERSION = '${next}';`;
const updatedApp = state.appSource.replace(before, after);
if (updatedApp === state.appSource) fail('APP_VERSION을 교체하지 못했습니다.');

writeFileSync(appPath, updatedApp, 'utf8');
writeFileSync(versionPath, `${next}\n`, 'utf8');
console.log(next);

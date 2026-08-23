#!/usr/bin/env bash
set -euo pipefail

bump_type="${BUMP_TYPE:-patch}"
base_sha="${BASE_SHA:?BASE_SHA가 필요합니다.}"
max_attempts=3

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for ((attempt=1; attempt<=max_attempts; attempt++)); do
  echo "버전 자동 증가 시도 ${attempt}/${max_attempts}"
  git fetch origin main --tags

  processed_commit="$(git log origin/main --format='%H' --fixed-strings --grep="기준 커밋: ${base_sha}" -1)"
  if [[ -n "$processed_commit" ]]; then
    echo "기준 커밋 ${base_sha}은 이미 ${processed_commit}에서 처리됐습니다."
    exit 0
  fi

  git switch --detach origin/main
  node scripts/version.mjs check
  next_version="$(node scripts/version.mjs bump "$bump_type")"

  if git rev-parse "refs/tags/v${next_version}" >/dev/null 2>&1; then
    echo "v${next_version} 태그가 이미 존재합니다. VERSION 상태를 확인하세요."
    exit 1
  fi

  node scripts/version.mjs check
  node -e "const fs=require('fs');const s=fs.readFileSync('stayup-dash.html','utf8');const m=s.match(/<script>([\s\S]*?)<\/script>/);if(!m)throw Error('script missing');new Function(m[1]);console.log('inline script syntax: OK')"
  git diff --check

  git add VERSION stayup-dash.html
  git commit -m "앱 버전 v${next_version} 자동 업데이트" -m "기준 커밋: ${base_sha}"
  git tag -a "v${next_version}" -m "STAY UP v${next_version} 자동 버전"

  if git push --atomic origin HEAD:refs/heads/main "refs/tags/v${next_version}"; then
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
      echo "version=${next_version}" >> "$GITHUB_OUTPUT"
    fi
    echo "v${next_version} 커밋과 태그를 원격에 반영했습니다."
    exit 0
  fi

  git tag -d "v${next_version}"
  echo "원격 main이 변경되어 최신 상태에서 다시 시도합니다."
done

echo "원격 경합으로 ${max_attempts}회 안에 버전을 반영하지 못했습니다."
exit 1

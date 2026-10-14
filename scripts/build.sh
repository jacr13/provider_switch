#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Error: %s is required. Install Node.js/npm and add them to PATH.\n' "$tool" >&2
    exit 1
  fi
done

printf 'Installing build dependencies...\n'
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

printf 'Running tests...\n'
npm test

printf 'Packaging extension...\n'
package="$PWD/claude-deepseek-switcher.vsix"
npm run package -- --out "$package"

printf '\nBuilt: %s\n' "$package"
answer=''
read -r -p 'Install this build in VS Code? [y/N]: ' answer || true
case "$answer" in
  y|Y|yes|YES|Yes)
    if ! command -v code >/dev/null 2>&1; then
      printf 'Error: VS Code command "code" is not on PATH. Use Extensions: Install from VSIX to install %s\n' "$package" >&2
      exit 1
    fi
    code --install-extension "$package" --force
    printf 'Installed. Run Developer: Reload Window in VS Code.\n'
    ;;
  *) printf 'Installation skipped.\n' ;;
esac

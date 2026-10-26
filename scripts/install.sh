#!/usr/bin/env sh
set -eu

REPO="zhravan/dbux"
API="https://api.github.com/repos/$REPO/releases/latest"
TMP_DIR="$(mktemp -d)"
MOUNT=""
cleanup() {
  if [ -n "$MOUNT" ] && command -v hdiutil >/dev/null 2>&1; then
    hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

fail() { printf 'DBUX installer: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v python3 >/dev/null 2>&1 || fail "python3 is required to choose a release asset."

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) fail "Unsupported CPU architecture: $ARCH" ;;
esac
case "$OS" in
  Linux)
    PLATFORM="linux"
    if command -v dpkg >/dev/null 2>&1; then
      FORMAT="deb"
    elif command -v rpm >/dev/null 2>&1; then
      FORMAT="rpm"
    else
      FORMAT="appimage"
    fi
    ;;
  Darwin) PLATFORM="macos"; FORMAT="dmg" ;;
  *) fail "Unsupported OS: $OS. On Windows use the PowerShell command in the README." ;;
esac

curl --fail --silent --show-error --location \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: DBUX-installer" \
  "$API" -o "$TMP_DIR/release.json" ||
  fail "Could not fetch the latest release. Check https://github.com/$REPO/releases"

ASSET_URL="$(python3 - "$TMP_DIR/release.json" "$PLATFORM" "$ARCH" "$FORMAT" <<'PY'
import json, sys

path, platform, arch, fmt = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    assets = json.load(handle).get("assets", [])

tokens = ("x86_64", "amd64", "x64") if arch == "x86_64" else ("aarch64", "arm64")
extensions = {"dmg": (".dmg",), "deb": (".deb",), "rpm": (".rpm",), "appimage": (".appimage",)}
candidates = [
    asset for asset in assets
    if any(asset.get("name", "").lower().endswith(ext) for ext in extensions[fmt])
]
matching = [
    asset for asset in candidates
    if any(token in asset.get("name", "").lower() for token in tokens)
]
if len(matching) == 1:
    chosen = matching[0]
elif not matching and len(candidates) == 1:
    chosen = candidates[0]
else:
    names = ", ".join(asset.get("name", "") for asset in candidates) or "no matching assets"
    raise SystemExit(f"No {fmt} installer for {arch}. Candidates: {names}")
print(chosen["browser_download_url"])
PY
)"
[ -n "$ASSET_URL" ] || fail "No compatible $PLATFORM installer found. See https://github.com/$REPO/releases/latest"
FILE_NAME="$(basename "$ASSET_URL")"
curl --fail --silent --show-error --location "$ASSET_URL" -o "$TMP_DIR/$FILE_NAME" ||
  fail "Failed to download $FILE_NAME"

case "$PLATFORM:$FILE_NAME" in
  linux:*.AppImage|linux:*.appimage)
    mkdir -p "$HOME/.local/bin" "$HOME/.local/opt/dbux" "$HOME/.local/share/applications"
    install -m 755 "$TMP_DIR/$FILE_NAME" "$HOME/.local/opt/dbux/DBUX.AppImage"
    cat > "$HOME/.local/bin/dbux" <<'LAUNCH'
#!/usr/bin/env sh
exec "$HOME/.local/opt/dbux/DBUX.AppImage" "$@"
LAUNCH
    chmod +x "$HOME/.local/bin/dbux"
    printf '[Desktop Entry]\nType=Application\nName=DBUX\nExec=%s/.local/opt/dbux/DBUX.AppImage\nTerminal=false\nCategories=Development;Database;\n' "$HOME" > "$HOME/.local/share/applications/dbux.desktop"
    printf 'Installed DBUX. Launch with ~/.local/bin/dbux (AppImage may require FUSE on your distro).\n'
    ;;
  linux:*.deb)
    command -v dpkg >/dev/null 2>&1 || fail "dpkg is required for this .deb package."
    if [ "$(id -u)" -eq 0 ]; then
      dpkg -i "$TMP_DIR/$FILE_NAME" || apt-get install --fix-broken -y
    else
      command -v sudo >/dev/null 2>&1 || fail "Installing a .deb requires root privileges or sudo."
      sudo dpkg -i "$TMP_DIR/$FILE_NAME" || sudo apt-get install --fix-broken -y
    fi
    printf 'Installed DBUX. Launch it from your desktop application menu.\n'
    ;;
  linux:*.rpm)
    if command -v dnf >/dev/null 2>&1; then
      if [ "$(id -u)" -eq 0 ]; then dnf install -y "$TMP_DIR/$FILE_NAME"; else sudo dnf install -y "$TMP_DIR/$FILE_NAME"; fi
    elif command -v zypper >/dev/null 2>&1; then
      if [ "$(id -u)" -eq 0 ]; then zypper --non-interactive install "$TMP_DIR/$FILE_NAME"; else sudo zypper --non-interactive install "$TMP_DIR/$FILE_NAME"; fi
    elif command -v rpm >/dev/null 2>&1; then
      if [ "$(id -u)" -eq 0 ]; then rpm -Uvh "$TMP_DIR/$FILE_NAME"; else sudo rpm -Uvh "$TMP_DIR/$FILE_NAME"; fi
    else
      fail "No RPM package manager was found."
    fi
    printf 'Installed DBUX. Launch it from your desktop application menu.\n'
    ;;
  macos:*.dmg)
    command -v hdiutil >/dev/null 2>&1 || fail "hdiutil is required to mount the DMG."
    mkdir -p "$HOME/Applications"
    attach_output="$(hdiutil attach "$TMP_DIR/$FILE_NAME" -nobrowse -quiet)"
    MOUNT="$(printf '%s\n' "$attach_output" | awk '/\/Volumes\// {print $NF; exit}')"
    [ -n "$MOUNT" ] || fail "Could not locate the mounted DMG volume."
    APP="$(find "$MOUNT" -type d -name 'DBUX.app' -print -quit)"
    [ -n "$APP" ] || fail "No DBUX.app bundle found inside the DMG."
    ditto "$APP" "$HOME/Applications/DBUX.app"
    hdiutil detach "$MOUNT" -quiet || true
    MOUNT=""
    printf 'Installed DBUX to ~/Applications/DBUX.app\n'
    printf 'If macOS blocks the app, approve it under System Settings > Privacy & Security; release builds are not notarized.\n'
    open "$HOME/Applications/DBUX.app" || true
    ;;
  *) fail "Unsupported release asset: $FILE_NAME. See https://github.com/$REPO/releases/latest" ;;
esac

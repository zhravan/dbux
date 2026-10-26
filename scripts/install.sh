#!/usr/bin/env sh
set -eu

REPO="zhravan/dbux"
API="https://api.github.com/repos/${REPO}/releases/latest"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM

fail() { printf 'DBUX installer: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v python3 >/dev/null 2>&1 || fail "python3 is required to select an installer."

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="x86_64" ;;
  aarch64|arm64) ARCH="aarch64" ;;
  *) fail "Unsupported CPU architecture: $ARCH" ;;
esac
case "$OS" in
  Linux) PLATFORM="linux" ;;
  Darwin) PLATFORM="macos" ;;
  *) fail "Unsupported OS: $OS. Use install.ps1 on Windows." ;;
esac

curl --fail --silent --show-error --location "$API" -o "$TMP_DIR/release.json" ||
  fail "Could not fetch the latest GitHub release."
ASSET_URL="$(python3 - "$TMP_DIR/release.json" "$PLATFORM" "$ARCH" <<'PY'
import json, sys
path, platform, arch = sys.argv[1:]
assets = json.load(open(path, encoding="utf-8")).get("assets", [])
def matches(name):
    n = name.lower()
    if platform == "linux":
        return n.endswith((".appimage", ".deb")) and (arch in n or "x86_64" in n or "amd64" in n)
    if platform == "macos":
        return n.endswith(".dmg") and (arch in n or "universal" in n or "aarch64" in n or "arm64" in n)
for asset in assets:
    if matches(asset["name"]):
        print(asset["browser_download_url"])
        break
PY
)"
[ -n "$ASSET_URL" ] || fail "No compatible $PLATFORM installer found. See https://github.com/$REPO/releases/latest"
FILE_NAME="${ASSET_URL##*/}"
curl --fail --silent --show-error --location "$ASSET_URL" -o "$TMP_DIR/$FILE_NAME"

case "$PLATFORM:$FILE_NAME" in
  linux:*.AppImage|linux:*.appimage)
    chmod +x "$TMP_DIR/$FILE_NAME"
    mkdir -p "$HOME/.local/bin" "$HOME/.local/opt/dbux" "$HOME/.local/share/applications"
    install -m 755 "$TMP_DIR/$FILE_NAME" "$HOME/.local/opt/dbux/DBUX.AppImage"
    cat > "$HOME/.local/bin/dbux" <<'LAUNCH'
#!/usr/bin/env sh
exec "$HOME/.local/opt/dbux/DBUX.AppImage" "$@"
LAUNCH
    chmod +x "$HOME/.local/bin/dbux"
    printf '[Desktop Entry]\nType=Application\nName=DBUX\nExec=%s/.local/opt/dbux/DBUX.AppImage\nTerminal=false\nCategories=Development;Database;\n' "$HOME" > "$HOME/.local/share/applications/dbux.desktop"
    printf 'Installed DBUX. Launch with dbux (ensure ~/.local/bin is on PATH).\n'
    ;;
  linux:*.deb)
    command -v dpkg >/dev/null 2>&1 || fail "dpkg is required for .deb packages."
    if command -v sudo >/dev/null 2>&1; then sudo dpkg -i "$TMP_DIR/$FILE_NAME"
    elif [ "$(id -u)" -eq 0 ]; then dpkg -i "$TMP_DIR/$FILE_NAME"
    else fail "Installing the .deb requires sudo; download the AppImage for a user-local install." ; fi
    ;;
  macos:*.dmg)
    hdiutil attach "$TMP_DIR/$FILE_NAME" -nobrowse -quiet
    MOUNT="$(hdiutil info | awk '/\/Volumes\// {print $NF}' | tail -n 1)"
    [ -n "$MOUNT" ] || fail "Could not locate mounted DMG volume."
    APP="$(find "$MOUNT" -maxdepth 2 -name '*.app' -print -quit)"
    [ -n "$APP" ] || fail "No .app bundle found inside DMG."
    ditto "$APP" "/Applications/DBUX.app" || fail "Could not copy to /Applications; move the app manually from $MOUNT."
    hdiutil detach "$MOUNT" -quiet || true
    printf 'Installed DBUX to /Applications/DBUX.app\n'
    ;;
  *) fail "Unsupported release asset: $FILE_NAME. See https://github.com/$REPO/releases/latest" ;;
esac

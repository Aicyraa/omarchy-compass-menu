#!/usr/bin/env bash
# Renders preview.png from the production Menu.qml with staged sample data.
# It runs a throwaway Quickshell config in a temp dir: no keyboard focus, a
# neutral backdrop in place of the desktop, and sample recents. Nothing under
# ~/.config or ~/.local/state is read or written, and the plugin is not installed.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
repo="$PWD"
shell_dir="${OMARCHY_SHELL_DIR:-/usr/share/omarchy/shell}"
rig="$(mktemp -d)"
trap 'kill "${qs_pid:-}" 2>/dev/null || true; rm -rf "$rig"' EXIT

cp -r "$shell_dir/Commons" "$shell_dir/Ui" "$shell_dir/services" "$rig/"
cp MenuModel.js "$rig/"
python3 - "$repo/Menu.qml" "$rig/Menu.qml" <<'PY'
import sys
s = open(sys.argv[1]).read()
def swap(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)
swap("WlrLayershell.keyboardFocus: root.opened ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None",
     "WlrLayershell.keyboardFocus: WlrKeyboardFocus.None")
swap('WlrLayershell.namespace: "omarchy-menu"', 'WlrLayershell.namespace: "compass-preview"')
swap("""    MouseArea {
      anchors.fill: parent
      onClicked: root.cancel()
    }
""", """    Rectangle {
      anchors.fill: parent
      z: -1
      gradient: Gradient {
        orientation: Gradient.Vertical
        GradientStop { position: 0.0; color: "#1b2030" }
        GradientStop { position: 1.0; color: "#0d0f16" }
      }
    }
""")
swap("  function ping() { return \"ok\" }", "  function ping() { return \"ok\" }\n  Component.onCompleted: Qt.callLater(function() { root.openRoute(\"root\") })")
open(sys.argv[2], "w").write(s)
PY

cat > "$rig/shell.qml" <<'QML'
import Quickshell
ShellRoot { Menu {} }
QML

# Sample usage only: category and toggle entries, no applications.
mkdir -p "$rig/state"
now=$(($(date +%s) * 1000))
cat > "$rig/state/compass-menu-recent.json" <<JSON
{"style.background":{"n":6,"t":$now},"style.theme":{"n":5,"t":$now},"install.aur":{"n":4,"t":$now},
 "trigger.capture.screenshot":{"n":3,"t":$now},"setup.audio":{"n":2,"t":$now},"update.omarchy":{"n":2,"t":$now}}
JSON

XDG_STATE_HOME="$rig/state" qs -p "$rig" >"$rig/qs.log" 2>&1 &
qs_pid=$!
sleep "${PREVIEW_DELAY:-4}"
grim "$rig/full.png"
# The card hangs from the top edge, centred horizontally. Crop around it and
# pad the top with the backdrop's own colour so the card does not touch the edge.
cw=${CARD_W:-700}; ch=${CARD_H:-500}
magick "$rig/full.png" -gravity north -crop "${cw}x${ch}+0+0" +repage \
  -background "#1b2030" -splice 0x28 "$repo/preview.png"
test -s preview.png
echo "Wrote $repo/preview.png"

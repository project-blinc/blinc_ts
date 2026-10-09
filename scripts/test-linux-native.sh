#!/usr/bin/env bash
set -euo pipefail
# Match the native desktop gates: use software Vulkan and a real headless compositor.
export VK_ICD_FILENAMES
VK_ICD_FILENAMES=$(find /usr/share/vulkan/icd.d -name '*lvp*.json' -print -quit)
[ -n "$VK_ICD_FILENAMES" ]
if [ "${NATIVE_TEST_DISPLAY:-x11}" = x11 ]; then
  mkdir -p .blinc
  exec xvfb-run -a -s '-screen 0 1280x800x24' bash -eu <<'X11'
openbox > .blinc/openbox.log 2>&1 & wm=$!
trap 'kill "$wm" 2>/dev/null || true' EXIT
sleep 1
npm run test:native
X11
fi
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
trap 'kill "${compositor:-}" 2>/dev/null || true; rm -rf "$XDG_RUNTIME_DIR"' EXIT
mkdir -p .blinc
cat > "$XDG_RUNTIME_DIR/sway.conf" <<'SWAY'
output HEADLESS-1 resolution 1280x800
# Let native resize requests take effect; tiling deliberately overrides them.
for_window [title=".*"] floating enable
SWAY
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=pixman \
  sway -c "$XDG_RUNTIME_DIR/sway.conf" > .blinc/sway.log 2>&1 & compositor=$!
for _ in $(seq 100); do
  socket=$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -print -quit)
  [ -n "$socket" ] && break
  kill -0 "$compositor" || { cat .blinc/sway.log; exit 1; }
  sleep 0.1
done
[ -n "${socket:-}" ] || { cat .blinc/sway.log; exit 1; }
export WAYLAND_DISPLAY
WAYLAND_DISPLAY=$(basename "$socket")
unset DISPLAY
npm run test:native

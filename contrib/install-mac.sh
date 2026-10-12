#!/bin/bash
# Install Kerbside Contributor: double-click this file (from the unzipped bundle).
# It installs a private Python, the screening code and its model, and a background job that
# screens street photographs for the Kerbside map while this Mac is idle. To turn it off, double-
# click "Stop Kerbside Contributor.command".
set -euo pipefail
cd "$(dirname "$0")"
HOME_DIR="$HOME/Library/Application Support/KerbsideContributor"
PLIST="$HOME/Library/LaunchAgents/com.kerbside.contributor.plist"
echo "Installing Kerbside Contributor into $HOME_DIR ..."
mkdir -p "$HOME_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
rm -rf "$HOME_DIR/app" && cp -R app "$HOME_DIR/app"
cp config.json "$HOME_DIR/config.json" && chmod 600 "$HOME_DIR/config.json"
rm -f "$HOME_DIR/OFF"
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
"$UV" venv --python 3.12 "$HOME_DIR/venv"
"$UV" pip install --python "$HOME_DIR/venv/bin/python" -e "$HOME_DIR/app" \
  "torch>=2.2" "transformers>=4.44" "huggingface_hub>=0.23" "safetensors>=0.4"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.kerbside.contributor</string>
  <key>ProgramArguments</key><array>
    <string>$HOME_DIR/venv/bin/python</string>
    <string>$HOME_DIR/app/contrib/kerbside_contributor.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/KerbsideContributor.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/KerbsideContributor.log</string>
</dict></plist>
PLISTEOF
launchctl bootout "gui/$(id -u)/com.kerbside.contributor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Kerbside Contributor is installed and running. Thank you!"
echo "It pauses whenever this Mac is busy or low on battery. To turn it off: Stop Kerbside Contributor.command"

#!/bin/bash
# Stop Kerbside Contributor: double-click to turn it off (and keep it off).
HOME_DIR="$HOME/Library/Application Support/KerbsideContributor"
mkdir -p "$HOME_DIR" && touch "$HOME_DIR/OFF"
launchctl bootout "gui/$(id -u)/com.kerbside.contributor" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.kerbside.contributor.plist"
echo "Kerbside Contributor is off. Run the installer again to turn it back on."

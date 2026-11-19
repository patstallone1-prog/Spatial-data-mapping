#!/bin/zsh
# Builds out/Kerbside.app from Kerbside.swift with the system swiftc (no Xcode project).
set -euo pipefail
here=${0:A:h}
out=$here/out
app=$out/Kerbside.app
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
swiftc -O -target arm64-apple-macos13.0 -framework AppKit -framework WebKit \
  -module-cache-path "$out/.module-cache" \
  -o "$app/Contents/MacOS/Kerbside" "$here/Kerbside.swift"
rm -rf "$out/.module-cache"
cp "$here/../desktop/icon.icns" "$app/Contents/Resources/icon.icns"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kerbside</string>
  <key>CFBundleDisplayName</key><string>Kerbside</string>
  <key>CFBundleIdentifier</key><string>app.kerbside.webkit</string>
  <key>CFBundleExecutable</key><string>Kerbside</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>NSLocationUsageDescription</key><string>Kerbside can start you where you are in the Bay Area.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Kerbside can start you where you are in the Bay Area.</string>
  <key>NSMicrophoneUsageDescription</key><string>Kerbside uses the microphone for voice chat with other players.</string>
  <key>NSCameraUsageDescription</key><string>Kerbside does not use the camera unless a page of the game asks for it.</string>
</dict>
</plist>
PLIST
codesign -s - --force --deep "$app"
du -sh "$app"

/**
 * Copies the static web build (web/) into the native Android assets so the
 * WebView can load it from file:///android_asset/web/index.html — fully
 * offline, no server needed.
 *
 * Runs automatically on `expo prebuild` (EAS Build runs prebuild for you).
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('expo/config-plugins');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

const withWebAssets = (config) => {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const src = path.join(projectRoot, 'web');
      const dest = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets', 'web');
      if (fs.existsSync(src)) {
        fs.rmSync(dest, { recursive: true, force: true });
        copyRecursive(src, dest);
        console.log(`✓ web assets copied (${dest})`);
      } else {
        console.warn(`⚠ web/ folder not found at ${src} — APK will have no UI!`);
      }
      return cfg;
    },
  ]);
};

module.exports = withWebAssets;

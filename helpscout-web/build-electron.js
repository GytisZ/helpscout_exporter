const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Paths
const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const electronDir = path.join(rootDir, 'electron');
const electronFrontendDir = path.join(electronDir, 'frontend');
const scriptsDir = path.join(electronDir, 'scripts');

// Ensure directories exist
if (!fs.existsSync(electronFrontendDir)) {
    fs.mkdirSync(electronFrontendDir, { recursive: true });
}

if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
}

// Build frontend
console.log('Building frontend...');
execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });

// Copy frontend build to electron directory
console.log('Copying frontend build to electron directory...');
execSync(`cp -r ${frontendDir}/dist/* ${electronFrontendDir}`, { stdio: 'inherit' });

// Install dependencies in electron directory
console.log('Installing electron dependencies...');
execSync('npm install electron-store@8.1.0', { cwd: electronDir, stdio: 'inherit' });
execSync('npm install electron-notarize --save-dev', { cwd: electronDir, stdio: 'inherit' });
execSync('npm install', { cwd: electronDir, stdio: 'inherit' });

// Create entitlements file if it doesn't exist
const entitlementsPath = path.join(electronDir, 'entitlements.plist');
if (!fs.existsSync(entitlementsPath)) {
    console.log('Creating entitlements.plist...');
    fs.writeFileSync(entitlementsPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
  </dict>
</plist>`);
}

// Create notarization script if it doesn't exist
const notarizeScriptPath = path.join(scriptsDir, 'notarize.js');
if (!fs.existsSync(notarizeScriptPath)) {
    console.log('Creating notarize.js script...');
    fs.writeFileSync(notarizeScriptPath, `const { notarize } = require('electron-notarize');
const { build } = require('../package.json');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;  
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // Only notarize if we have Apple credentials
  if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD) {
    console.log('Skipping notarization: Apple ID credentials not found');
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  console.log(\`Notarizing \${appName}...\`);

  return await notarize({
    appBundleId: build.appId,
    appPath: \`\${appOutDir}/\${appName}.app\`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
  });
};`);
}

// Build electron app
console.log('Building electron app...');
execSync('npm run build:mac', { cwd: electronDir, stdio: 'inherit' });

console.log('Build complete! Electron app is in the electron/dist directory.'); 

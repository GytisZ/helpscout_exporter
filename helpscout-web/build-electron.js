const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Paths
const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const electronDir = path.join(rootDir, 'electron');
const electronFrontendDir = path.join(electronDir, 'frontend');

// Ensure directories exist
if (!fs.existsSync(electronFrontendDir)) {
    fs.mkdirSync(electronFrontendDir, { recursive: true });
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
execSync('npm install', { cwd: electronDir, stdio: 'inherit' });

// Build electron app
console.log('Building electron app...');
execSync('npm run build', { cwd: electronDir, stdio: 'inherit' });

console.log('Build complete! Electron app is in the electron/dist directory.'); 

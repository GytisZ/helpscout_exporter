const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Paths
const rootDir = __dirname;
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const electronDir = path.join(rootDir, 'electron');

// Create directories if they don't exist
console.log('Creating directories...');
[frontendDir, backendDir, electronDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Initialize frontend (Vite + React + TypeScript)
console.log('Setting up frontend...');
execSync('npm create vite@latest . -- --template react-ts', {
    cwd: frontendDir,
    stdio: 'inherit'
});
execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });

// Initialize backend
console.log('Setting up backend...');
execSync('npm init -y', { cwd: backendDir, stdio: 'inherit' });
execSync('npm install express cors dotenv axios', {
    cwd: backendDir,
    stdio: 'inherit'
});
execSync('npm install --save-dev typescript @types/express @types/cors @types/node ts-node nodemon', {
    cwd: backendDir,
    stdio: 'inherit'
});

// Initialize electron
console.log('Setting up electron...');
execSync('npm init -y', { cwd: electronDir, stdio: 'inherit' });
execSync('npm install electron electron-builder', {
    cwd: electronDir,
    stdio: 'inherit'
});

console.log('Setup complete! You can now run the build-electron.js script.'); 

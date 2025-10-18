const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Ask if the user wants to notarize the app
rl.question('Do you want to notarize the app with Apple? (y/n) ', (answer) => {
    const shouldNotarize = answer.toLowerCase() === 'y';

    if (shouldNotarize) {
        rl.question('Enter your Apple ID: ', (appleId) => {
            rl.question('Enter your app-specific password: ', (password) => {
                buildMacApp(appleId, password);
                rl.close();
            });
        });
    } else {
        buildMacApp();
        rl.close();
    }
});

function buildMacApp(appleId = '', password = '') {
    // Set environment variables for notarization if provided
    if (appleId && password) {
        process.env.APPLE_ID = appleId;
        process.env.APPLE_ID_PASSWORD = password;
    }

    try {
        // Run the build-electron.js script
        console.log('Building the app...');
        execSync('node build-electron.js', { stdio: 'inherit' });

        console.log('\nBuild completed successfully!');

        if (appleId && password) {
            console.log('\nThe app has been submitted for notarization.');
            console.log('This process can take several minutes to complete.');
            console.log('Once notarized, the app will be ready for distribution.');
        } else {
            console.log('\nThe app was built without notarization.');
            console.log('Users may see security warnings when trying to run the app.');
            console.log('To avoid this, build with notarization next time.');
        }

        console.log('\nYou can find the built app in:');
        console.log('helpscout-web/electron/dist/');
    } catch (error) {
        console.error('Build failed:', error);
    }
} 

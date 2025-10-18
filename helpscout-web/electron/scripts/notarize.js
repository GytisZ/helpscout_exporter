const { notarize } = require('electron-notarize');
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

    console.log(`Notarizing ${appName}...`);

    return await notarize({
        appBundleId: build.appId,
        appPath: `${appOutDir}/${appName}.app`,
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_ID_PASSWORD,
    });
}; 

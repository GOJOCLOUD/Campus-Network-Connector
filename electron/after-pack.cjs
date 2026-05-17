const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${productName}.app`);
  const bundleId = 'com.gojocloud.crossscreeninput';

  // Ad-hoc sign the whole .app bundle (includes native .node addon)
  try {
    execSync(
      `codesign --force --deep --sign - --identifier "${bundleId}" "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log(`[afterPack] ad-hoc signed ${appPath} (${bundleId})`);
  } catch (e) {
    console.error('[afterPack] re-sign failed:', e.message);
  }
};

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  const { appOutDir, packager, arch } = context;
  const productName = packager.appInfo.productName;
  const appPath = path.join(appOutDir, `${productName}.app`);
  const bundleId = 'com.gojocloud.crossscreeninput';
  const executable = path.join(appPath, 'Contents', 'MacOS', productName);

  // 关 ASAR 融合，否则 unpack 的文件无法使用
  try {
    const { flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');
    await flipFuses(executable, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableEmbeddedAsarIntegrity]: false,
    });
    console.log(`[afterPack] fuse disabled for ${productName}`);
  } catch (e) {
    console.error('[afterPack] flipFuses failed, skipping fuse disable:', e.message);
  }

  // 关 fuse 破坏了 electron-builder 刚做的签名，重新 ad-hoc 签名
  try {
    execSync(
      `codesign --force --sign - --identifier "${bundleId}" "${appPath}"`,
      { stdio: 'inherit' }
    );
    console.log(`[afterPack] ad-hoc signed ${appPath} (${bundleId})`);
  } catch (e) {
    console.error('[afterPack] re-sign failed:', e.message);
  }
};

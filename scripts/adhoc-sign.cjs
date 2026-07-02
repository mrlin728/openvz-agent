// electron-builder afterPack hook — properly ad-hoc code-signs the macOS app.
//
// 为什么需要：没有 Apple 付费证书时 electron-builder 会“跳过签名”，于是 .app 只保留
// Electron 二进制自带的 linker-signed 签名，而它对改动过的 bundle 是【无效】的
// （Sealed Resources=none、Identifier=Electron）。用户从网上下载后带 quarantine 标记，
// Gatekeeper 校验签名失败 → 报“已损坏，应移到废纸篓”。
//
// 解决：用 ad-hoc 签名（codesign --sign -）对整个 bundle 由内到外重新签名，封装资源、
// 绑定 Info.plist、写入正确的 bundle id。这样签名有效，下载后变成较温和的
// “无法验证开发者”提示，右键→打开即可运行（配合去除 quarantine 更稳）。
// 注意：ad-hoc 不等于 Apple 公证，无法做到“双击零提示”，那需要 Developer ID + notarize。

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const bundleId = context.packager.appInfo.id || 'com.openvz.agent';

  if (!fs.existsSync(appPath)) {
    console.warn(`[adhoc-sign] app not found: ${appPath}`);
    return;
  }

  // 先给内部的 Frameworks / Helpers 逐个 ad-hoc 签名（由内到外），最后签外层 .app。
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  const signOne = (target, extraArgs = []) => {
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', ...extraArgs, target], { stdio: 'inherit' });
  };

  if (fs.existsSync(frameworks)) {
    for (const entry of fs.readdirSync(frameworks)) {
      const full = path.join(frameworks, entry);
      // Helper 应用内部还有可执行文件，用 --deep 一并处理。
      signOne(full, entry.endsWith('.app') ? ['--deep'] : []);
    }
  }

  // 外层 app：deep + 指定正确的 bundle id，封装资源。
  signOne(appPath, ['--deep', '--identifier', bundleId]);

  // 校验，失败直接抛错终止构建，避免又发出坏签名的包。
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
  console.log(`[adhoc-sign] ad-hoc signed & verified: ${appName} (${bundleId})`);
};

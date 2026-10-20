// @effect-diagnostics nodeBuiltinImport:off -- Electron Builder calls this Node hook outside the Effect runtime.
import { sign as signApplication } from "@electron/osx-sign";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { PERSONAL_DESKTOP } from "@t3tools/shared/personalDesktop";

export default async function signPersonalMac(context: {
  appOutDir: string;
  electronPlatformName: string;
  packager: {
    config: { electronFuses?: unknown };
    appInfo: { productFilename: string };
  };
}) {
  if (context.electronPlatformName !== "darwin")
    throw new Error("Personal signing requires macOS.");
  if (context.packager.config.electronFuses != null) {
    throw new Error(
      "Electron fuses run after afterPack. Move fuse changes before personal signing.",
    );
  }
  const identity = process.env.T3CODE_PERSONAL_SIGN_IDENTITY;
  if (!identity || !/^[A-F0-9]{40}$/u.test(identity)) {
    throw new Error(
      "Set T3CODE_PERSONAL_SIGN_IDENTITY to the local certificate SHA-1 fingerprint.",
    );
  }
  const app = NodePath.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await signApplication({
    app,
    identity,
    identityValidation: false,
    type: "distribution",
    platform: "darwin",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      entitlements: NodePath.join(import.meta.dirname, "personal-macos-entitlements.plist"),
      hardenedRuntime: true,
      timestamp: "none",
    }),
  });
  NodeChildProcess.execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  if (context.packager.appInfo.productFilename !== PERSONAL_DESKTOP.productName) {
    throw new Error("The signed product name does not match the personal identity.");
  }
}

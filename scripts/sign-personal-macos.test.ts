import { describe, expect, it } from "vite-plus/test";
import signPersonalMac from "./sign-personal-macos.ts";

describe("personal afterPack signing", () => {
  it("rejects fuses that Electron Builder would mutate after signing", async () => {
    await expect(
      signPersonalMac({
        appOutDir: "/unused",
        electronPlatformName: "darwin",
        packager: {
          config: { electronFuses: {} },
          appInfo: { productFilename: "T3 Code Personal" },
        },
      }),
    ).rejects.toThrow("Electron fuses run after afterPack");
  });
  it("rejects non-macOS packaging before signing", async () => {
    await expect(
      signPersonalMac({
        appOutDir: "/unused",
        electronPlatformName: "linux",
        packager: { config: {}, appInfo: { productFilename: "T3 Code Personal" } },
      }),
    ).rejects.toThrow("requires macOS");
  });
});

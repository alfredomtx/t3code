import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import signPersonalMac from "./sign-personal-macos.ts";

describe("personal macOS signing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a missing certificate fingerprint", async () => {
    vi.stubEnv("T3CODE_PERSONAL_SIGN_IDENTITY", undefined);
    await expect(
      signPersonalMac({ app: "/unused/T3 Code Personal.app", platform: "darwin" }),
    ).rejects.toThrow("certificate SHA-1 fingerprint");
  });

  it("refuses other products before signing", async () => {
    vi.stubEnv("T3CODE_PERSONAL_SIGN_IDENTITY", "A".repeat(40));
    await expect(
      signPersonalMac({ app: "/unused/T3 Code.app", platform: "darwin" }),
    ).rejects.toThrow("product name does not match");
  });

  it("rejects non-macOS packaging before signing", async () => {
    await expect(
      signPersonalMac({ app: "/unused/T3 Code Personal.app", platform: "linux" }),
    ).rejects.toThrow("requires macOS");
  });
});

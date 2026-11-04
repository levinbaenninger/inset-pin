import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { AfterPackContext } from "electron-builder";

/**
 * "Inset Prototype Signing", a self-signed certificate. electron-builder only
 * looks for identities macOS trusts, so the hook signs with codesign itself.
 * The designated requirement names this certificate as the root, which keeps
 * it the same across builds: macOS keeps permission grants and Squirrel.Mac
 * accepts the update.
 */
const IDENTITY = "2FA2057FB218EEC7CBB6961B18455C35C470D7E2";

const keychain =
  process.env.INSET_SIGNING_KEYCHAIN ??
  path.join(homedir(), "Library/Keychains/inset-signing.keychain-db");

const signMac = (context: AfterPackContext): void => {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const hasIdentity = existsSync(keychain);

  if (!hasIdentity) {
    if (process.env.INSET_REQUIRE_SIGNING === "1") {
      throw new Error(
        `No signing keychain at ${keychain}. An ad-hoc build can't update a signed install.`
      );
    }

    console.warn(
      `No signing keychain at ${keychain}; signing ad-hoc. This build can't auto-update.`
    );
  }

  execFileSync(
    "codesign",
    [
      "--force",
      "--deep",
      "--sign",
      ...(hasIdentity ? [IDENTITY, "--keychain", keychain] : ["-"]),
      app,
    ],
    { stdio: "inherit" }
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "inherit",
  });
};

export default signMac;

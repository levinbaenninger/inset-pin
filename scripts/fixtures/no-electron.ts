/**
 * What `electron` resolves to in unit tests (vitest.config.ts). The electron
 * package downloads its binary the first time it is required, so a test that
 * reached it failed CI whenever GitHub's download did. Code under test takes
 * Electron's parts as arguments, or loads them where they are used.
 */
throw new Error(
  "A unit test required electron. Pass the Electron part in, or import it lazily where it is used."
);

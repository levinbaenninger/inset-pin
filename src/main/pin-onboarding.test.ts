import { describe, expect, it } from "vitest";

import { fakeMac } from "./permissions/fakes";
import { ACCESS, DONE, record } from "./permissions/flow";
import type { OnboardingRecord } from "./permissions/flow";
import { ADVANCE_MS, createOnboarding } from "./permissions/onboarding";
import type { Closed, Presentation } from "./permissions/onboarding";
import { createPermissionChecks, PANE_URLS } from "./permissions/system";
import {
  osMajor,
  PIN_HANDOFF,
  PIN_PERMISSIONS,
  PIN_TAGLINE,
} from "./pin-onboarding";
import { createQuitPath } from "./quit-path";

const ignore = (): void => undefined;

const memoryStore = (initial: OnboardingRecord | null = null) => {
  let saved = initial;

  return {
    read: async () => await Promise.resolve(saved),
    saved: () => saved,
    write: async (next: OnboardingRecord) => {
      saved = next;
      await Promise.resolve();
    },
  };
};

type Mac = ReturnType<typeof fakeMac>;

/**
 * One run of Inset Context Pin's setup: the kit with Pin's permission and
 * words, quitting through Pin's quit path, whose library page can cancel a
 * quit without telling main.
 */
const launchPin = (
  options: {
    readonly mac?: Mac;
    readonly store?: ReturnType<typeof memoryStore>;
    readonly isMac?: boolean;
    readonly ranBefore?: boolean;
  } = {}
) => {
  const mac = options.mac ?? fakeMac();
  const store = options.store ?? memoryStore();
  const log: string[] = [];
  const closed: Closed[] = [];
  const presented: Presentation[] = [];
  let leaving: (() => void) | null = null;
  let ended = false;
  // Set once the onboarding exists.
  let quitCancelled = ignore;

  const quitPath = createQuitPath({
    allowQuit: () => true,
    leave: (then) => {
      leaving = then;
    },
    onDropped: () => {
      quitCancelled();
    },
    requestQuit: () => {
      if (ended) {
        return;
      }

      let prevented = false;

      quitPath.beforeQuit({
        preventDefault: () => {
          prevented = true;
        },
      });

      if (!prevented) {
        quitPath.willQuit();
        log.push("exit");
        ended = true;
      }
    },
  });

  const onboarding = createOnboarding({
    appName: "Inset Context Pin",
    checks: createPermissionChecks(mac.system),
    handOff: PIN_HANDOFF,
    mac: options.isMac ?? true,
    onClosed: (how) => {
      closed.push(how);
    },
    onEnded: () => {
      log.push("ended");
    },
    onView: ignore,
    osMajor: 26,
    permissions: PIN_PERMISSIONS,
    pollFast: ignore,
    quit: (atExit) => {
      quitPath.quit(atExit);
    },
    ranBefore: async () => await Promise.resolve(options.ranBefore ?? false),
    relaunch: () => {
      log.push("relaunch");
    },
    setTimer: mac.clock.setTimer,
    store,
    tagline: PIN_TAGLINE,
    tile: () => null,
    window: {
      hide: () => {
        log.push("hide");
      },
      present: (presentation) => {
        presented.push(presentation);
      },
    },
  });

  ({ quitCancelled } = onboarding);

  return {
    closed,
    log,
    mac,
    onboarding,
    /** Cancel in the library page's prompt: main never hears of it. */
    pageCancels: () => {
      leaving = null;
    },
    presented,
    quitPath,
    screen: () => onboarding.view().permissions[0]?.state,
    /** The library saved what is typed, so the quit goes on. */
    saved: () => {
      const then = leaving;

      leaving = null;
      then?.();
    },
    step: () => onboarding.view().step.kind,
    steps: () => onboarding.view().steps.map((step) => step.kind),
    store,
  };
};

describe("Inset Context Pin's setup", () => {
  it("is Welcome, Allow access with Screen Recording only, and Done, in Pin's words", async () => {
    const pin = launchPin();

    await expect(pin.onboarding.launch()).resolves.toBeTruthy();

    const view = pin.onboarding.view();

    expect({
      handOff: view.handOff,
      rows: view.permissions.map(({ features, id, listName, purpose }) => ({
        features,
        id,
        listName,
        purpose,
      })),
      step: pin.step(),
      steps: pin.steps(),
      tagline: view.tagline,
    }).toStrictEqual({
      handOff: PIN_HANDOFF,
      rows: [
        {
          features: ["⌥⌘P"],
          id: "screen",
          listName: "Screen & System Audio Recording",
          purpose:
            "Lets ⌥⌘P capture the spot you point at. Only the crop you save is kept.",
        },
      ],
      step: "welcome",
      steps: ["welcome", "access", "done"],
      tagline: PIN_TAGLINE,
    });
  });

  it("leaves out Allow access when Screen Recording is already granted", async () => {
    const pin = launchPin({ mac: fakeMac({ screen: true }) });

    await pin.onboarding.launch();
    pin.onboarding.next();

    expect({ step: pin.step(), steps: pin.steps() }).toStrictEqual({
      step: "done",
      steps: ["welcome", "done"],
    });
  });

  it("lists the app in System Settings, opens its pane beside the window, then offers Reopen to finish", async () => {
    const pin = launchPin();

    await pin.onboarding.launch();
    pin.onboarding.next();
    pin.onboarding.allow("screen");

    expect({
      calls: pin.mac.calls,
      presented: pin.presented.at(-1),
      row: pin.screen(),
    }).toStrictEqual({
      calls: ["getSources screen 1x1", `open ${PANE_URLS.screen}`],
      presented: { floating: true, focus: false, place: "edge" },
      row: "reopen",
    });
  });

  it("comes back on Allow access after the reopen, shows Screen Recording allowed, then Done", async () => {
    const mac = fakeMac();
    const store = memoryStore();
    const first = launchPin({ mac, store });

    await first.onboarding.launch();
    first.onboarding.next();
    first.onboarding.allow("screen");
    mac.grant("screen");
    await first.onboarding.reopen();
    first.saved();

    const before = { log: [...first.log], saved: store.saved() };

    mac.relaunched();

    const second = launchPin({ mac, store });

    await expect(second.onboarding.launch()).resolves.toBeTruthy();

    const landed = { row: second.screen(), step: second.step() };

    mac.clock.advance(ADVANCE_MS);

    const after = second.step();

    second.onboarding.finish("showAround");

    expect({
      after,
      before,
      closed: second.closed,
      landed,
      saved: store.saved(),
    }).toStrictEqual({
      after: "done",
      before: { log: ["relaunch", "exit"], saved: record("active", ACCESS) },
      closed: ["showAround"],
      landed: { row: "allowed", step: "access" },
      saved: record("finished", DONE),
    });
  });

  it("never relaunches at a later Quit after the reopen's quit was cancelled in the library", async () => {
    const pin = launchPin();

    await pin.onboarding.launch();
    pin.onboarding.next();
    pin.onboarding.allow("screen");
    await pin.onboarding.reopen();

    const during = pin.screen();

    pin.pageCancels();
    // Quit Inset Context Pin, later.
    pin.quitPath.quit();

    // The dropped reopen shows Reopen to finish again, should this quit be cancelled too.
    const after = pin.screen();

    pin.saved();

    expect({ after, during, log: pin.log }).toStrictEqual({
      after: "reopen",
      during: "reopening",
      log: ["exit"],
    });
  });

  it("asks again when Reopening… is pressed after a cancel main never heard of, and relaunches once", async () => {
    const pin = launchPin();

    await pin.onboarding.launch();
    pin.onboarding.next();
    pin.onboarding.allow("screen");
    await pin.onboarding.reopen();
    pin.pageCancels();
    await pin.onboarding.reopen();
    pin.saved();

    expect(pin.log).toStrictEqual(["relaunch", "exit"]);
  });

  it("does nothing on Windows but set the first-run flag", async () => {
    const pin = launchPin({
      isMac: false,
      mac: fakeMac({}, { platform: "win32" }),
    });

    await expect(pin.onboarding.launch()).resolves.toBeFalsy();

    pin.onboarding.open("screen");
    pin.onboarding.allow("screen");

    expect({
      calls: pin.mac.calls,
      open: pin.onboarding.isOpen(),
      presented: pin.presented,
      saved: pin.store.saved(),
    }).toStrictEqual({
      calls: [],
      open: false,
      presented: [],
      saved: record("finished", DONE),
    });
  });

  it("opens at Allow access from the capture panel, after the first run, with Screen Recording picked out", async () => {
    const pin = launchPin({ ranBefore: true });

    await expect(pin.onboarding.launch()).resolves.toBeFalsy();

    pin.onboarding.open("screen");

    expect({
      focus: pin.onboarding.view().focus,
      presented: pin.presented.at(-1),
      step: pin.step(),
    }).toStrictEqual({
      focus: "screen",
      presented: { floating: true, focus: true, place: "center" },
      step: "access",
    });
  });

  it("ends for good with Not now on Welcome, and lets the library come up", async () => {
    const pin = launchPin();

    await pin.onboarding.launch();
    pin.onboarding.skip();

    expect({
      closed: pin.closed,
      log: pin.log,
      saved: pin.store.saved(),
    }).toStrictEqual({
      closed: ["skipped"],
      log: ["hide", "ended"],
      saved: record("skipped", DONE),
    });
  });
});

describe(osMajor, () => {
  it("reads the major version, and 0 for anything else", () => {
    expect([osMajor("26.1"), osMajor("27.0.1"), osMajor("")]).toStrictEqual([
      26, 27, 0,
    ]);
  });
});

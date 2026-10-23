import { eventChannel, methodChannel } from "@shared/ipc";
import type { Contract } from "@shared/ipc";
import { contextBridge, ipcRenderer } from "electron";

/** The page can call only declared methods and events; it can never name a channel. */
export const exposeContract = (contract: Contract): void => {
  const methods = Object.fromEntries(
    Object.entries(contract.methods).map(([name, spec]) => {
      const channel = methodChannel(contract, name);

      return [
        name,
        spec.kind === "invoke"
          ? ipcRenderer.invoke.bind(ipcRenderer, channel)
          : ipcRenderer.send.bind(ipcRenderer, channel),
      ];
    })
  );

  const events = new Set(Object.keys(contract.events));

  const on = (
    name: string,
    listener: (...payload: readonly unknown[]) => void
  ): (() => void) => {
    if (!events.has(name)) {
      throw new Error(`${contract.name} has no event ${name}`);
    }

    const channel = eventChannel(contract, name);

    const forward = (
      _event: Electron.IpcRendererEvent,
      ...payload: readonly unknown[]
    ): void => {
      listener(...payload);
    };

    ipcRenderer.on(channel, forward);

    return () => {
      ipcRenderer.removeListener(channel, forward);
    };
  };

  contextBridge.exposeInMainWorld(contract.global, { ...methods, on });
};

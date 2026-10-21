import { app } from "electron";

app.on("window-all-closed", () => {
  // A tray utility keeps running without windows.
});

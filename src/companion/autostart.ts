import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner";

import { CompanionAutostartError } from "./error.ts";

export type AutostartPlatform = "windows" | "systemd" | "launchd";

/** Everything the platform launcher needs to re-run this CLI as `companion run`. */
export interface AutostartTarget {
  readonly platform: AutostartPlatform;
  readonly homeDir: string;
  /** The user id launchd addresses the GUI domain by; unused elsewhere. */
  readonly uid: number;
  /** The command and arguments that run the daemon in the foreground. */
  readonly command: ReadonlyArray<string>;
}

export interface AutostartResult {
  readonly platform: AutostartPlatform;
  /** The scheduled task name, or the unit or plist file. */
  readonly location: string;
}

const windowsTaskName = "t3cli companion";
const systemdUnit = "t3cli-companion.service";
const launchdLabel = "dev.t3cli.companion";

export const quotePowerShell = (value: string) => `'${value.replace(/'/g, "''")}'`;

// CommandLineToArgvW quoting: backslashes double only before a quote or the closing quote.
export const quoteWindowsArg = (arg: string) =>
  `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;

const quoteSystemdArg = (arg: string) =>
  `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`;

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const runTool = Effect.fn("runAutostartTool")(function* (
  operation: string,
  command: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(command, [...args]));
  const [output, exitCode] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(child.all)), child.exitCode],
    { concurrency: "unbounded" },
  );
  if (Number(exitCode) !== 0) {
    return yield* new CompanionAutostartError({
      message: `${command} exited with code ${Number(exitCode)} while trying to ${operation}`,
      operation,
      output: output.trim(),
    });
  }
  return output;
}, Effect.scoped);

const toAutostartError = (operation: string) => (cause: { readonly message: string }) =>
  new CompanionAutostartError({
    message: `failed to ${operation}`,
    operation,
    output: cause.message,
  });

// The task runs the daemon under `conhost --headless`, so no console window opens at logon.
const windowsScript = (target: AutostartTarget) => {
  const [executable, ...args] = target.command;
  const argument = ["--headless", executable ?? "", ...args].map(quoteWindowsArg).join(" ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ${quotePowerShell(argument)}`,
    "$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)",
    "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden",
    `Register-ScheduledTask -TaskName ${quotePowerShell(windowsTaskName)} -Action $action -Trigger $trigger -Settings $settings -Description 't3cli companion daemon' -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${quotePowerShell(windowsTaskName)}`,
  ].join("; ");
};

const systemdUnitFile = (target: AutostartTarget) =>
  [
    "[Unit]",
    "Description=t3cli companion daemon",
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${target.command.map(quoteSystemdArg).join(" ")}`,
    // `companion stop` exits cleanly, so only crashes restart it.
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

const launchdPlist = (target: AutostartTarget) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${launchdLabel}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...target.command.map((arg) => `    <string>${escapeXml(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key><true/>",
    // `companion stop` exits cleanly, so only crashes restart it.
    "  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
    "  <key>ProcessType</key><string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");

const unitPath = (path: Path.Path, target: AutostartTarget) =>
  target.platform === "systemd"
    ? path.join(target.homeDir, ".config", "systemd", "user", systemdUnit)
    : path.join(target.homeDir, "Library", "LaunchAgents", `${launchdLabel}.plist`);

/** Registers the daemon to start at login and starts it now. Re-running replaces the entry. */
export const installAutostart = Effect.fn("installAutostart")(function* (target: AutostartTarget) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  switch (target.platform) {
    case "windows": {
      yield* runTool("register the scheduled task", "powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsScript(target),
      ]);
      return { platform: target.platform, location: windowsTaskName } satisfies AutostartResult;
    }
    case "systemd": {
      const file = unitPath(path, target);
      yield* fs
        .makeDirectory(path.dirname(file), { recursive: true })
        .pipe(Effect.mapError(toAutostartError("create the systemd user unit directory")));
      yield* fs
        .writeFileString(file, systemdUnitFile(target))
        .pipe(Effect.mapError(toAutostartError("write the systemd user unit")));
      yield* runTool("reload systemd", "systemctl", ["--user", "daemon-reload"]);
      yield* runTool("enable the systemd user unit", "systemctl", [
        "--user",
        "enable",
        "--now",
        systemdUnit,
      ]);
      return { platform: target.platform, location: file } satisfies AutostartResult;
    }
  }
  const file = unitPath(path, target);
  yield* fs
    .makeDirectory(path.dirname(file), { recursive: true })
    .pipe(Effect.mapError(toAutostartError("create the LaunchAgents directory")));
  // A loaded agent must be booted out before its plist is replaced.
  yield* runTool("unload the previous launch agent", "launchctl", [
    "bootout",
    `gui/${target.uid}/${launchdLabel}`,
  ]).pipe(Effect.catchTag("CompanionAutostartError", () => Effect.void));
  yield* fs
    .writeFileString(file, launchdPlist(target))
    .pipe(Effect.mapError(toAutostartError("write the launch agent")));
  yield* runTool("load the launch agent", "launchctl", ["bootstrap", `gui/${target.uid}`, file]);
  return { platform: target.platform, location: file } satisfies AutostartResult;
});

/** Removes the login entry; a running daemon keeps running until `companion stop`. */
export const uninstallAutostart = Effect.fn("uninstallAutostart")(function* (
  target: AutostartTarget,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  switch (target.platform) {
    case "windows": {
      yield* runTool("remove the scheduled task", "powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference = 'Stop'; if (Get-ScheduledTask -TaskName ${quotePowerShell(windowsTaskName)} -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName ${quotePowerShell(windowsTaskName)} -Confirm:$false }`,
      ]);
      return { platform: target.platform, location: windowsTaskName } satisfies AutostartResult;
    }
    case "systemd": {
      const file = unitPath(path, target);
      yield* runTool("disable the systemd user unit", "systemctl", [
        "--user",
        "disable",
        systemdUnit,
      ]).pipe(Effect.catchTag("CompanionAutostartError", () => Effect.void));
      yield* fs
        .remove(file, { force: true })
        .pipe(Effect.mapError(toAutostartError("remove the systemd user unit")));
      yield* runTool("reload systemd", "systemctl", ["--user", "daemon-reload"]);
      return { platform: target.platform, location: file } satisfies AutostartResult;
    }
  }
  const file = unitPath(path, target);
  // `bootout` would also stop the daemon; removing the plist only affects the next login.
  yield* fs
    .remove(file, { force: true })
    .pipe(Effect.mapError(toAutostartError("remove the launch agent")));
  return { platform: target.platform, location: file } satisfies AutostartResult;
});

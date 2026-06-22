import { Flag, GlobalFlag } from "effect/unstable/cli";

export const cliEnvironmentSetting = GlobalFlag.setting("environment")({
  flag: Flag.string("environment").pipe(
    Flag.withDescription("Auth environment name for this command"),
    Flag.optional,
  ),
});

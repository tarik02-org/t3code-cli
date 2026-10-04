import { Flag, GlobalFlag } from "effect/unstable/cli";

export const cliEnvironmentSetting = GlobalFlag.Setting("environment")({
  flag: Flag.String("environment").pipe(
    Flag.withDescription("Auth environment name for this command"),
    Flag.optional,
  ),
});

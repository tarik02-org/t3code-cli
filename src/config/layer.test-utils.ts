import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Credential from "./credential/service.ts";
import * as Config from "./config.ts";
import * as Selection from "./selection/service.ts";
import { CliRuntime } from "../cli/runtime/service.ts";
import { ConfigPlatformLayer } from "./platform.test-utils.ts";
import { t3CliEnvConfigLayer } from "./env/env.test-utils.ts";
import * as CredentialCipherWeb from "./credential/cipher-web.ts";
import * as Keystore from "./keystore/service.test-utils.ts";

export type T3ConfigLayerTestInput = {
  readonly selection?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly useSelectionLive?: boolean;
};

export function t3ConfigDepsLayer(homeDir: string, input: T3ConfigLayerTestInput = {}) {
  const cliRuntimeLayer = CliRuntime.layerTest({ cwd: homeDir });
  const configLayer = t3CliEnvConfigLayer(homeDir, input.env ?? {});
  const platformEnvLayer = Layer.mergeAll(cliRuntimeLayer, configLayer);
  const selectionLayer =
    input.useSelectionLive === true
      ? Selection.layer.pipe(Layer.provide(platformEnvLayer))
      : Layer.succeed(Selection.T3ConfigSelection)({
          getSelectedEnvironment: () => Effect.succeed(input.selection),
        });

  return Config.layer.pipe(
    Layer.provide(Credential.layer),
    Layer.provide(
      Layer.mergeAll(
        platformEnvLayer,
        selectionLayer,
        CredentialCipherWeb.layerWeb,
        Keystore.unavailableKeystoreFactoryLayer,
      ),
    ),
  );
}

export function t3ConfigLayerTest(homeDir: string, input: T3ConfigLayerTestInput = {}) {
  return Layer.mergeAll(ConfigPlatformLayer, t3ConfigDepsLayer(homeDir, input));
}

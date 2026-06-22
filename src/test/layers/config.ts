import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layer as T3ConfigLive } from "../../config/layer.ts";
import { layer as T3CredentialCryptoLive } from "../../config/credential.ts";
import { layerWeb as T3CredentialCipherWebLive } from "../../config/credential-cipher-web.ts";
import { T3ConfigSelection } from "../../config/selection.ts";
import { T3ConfigSelectionLive } from "../../config/selection-layer.ts";
import { Environment } from "../../environment/service.ts";
import { ConfigPlatformLayer } from "../platform.ts";
import { unavailableKeystoreFactoryLayer } from "./keystore-unavailable.ts";

export type T3ConfigLayerTestInput = {
  readonly selection?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly useSelectionLive?: boolean;
};

export function t3ConfigDepsLayer(homeDir: string, input: T3ConfigLayerTestInput = {}) {
  const environmentLayer = Environment.layerTest({
    homeDir,
    ...(input.env !== undefined ? { env: input.env } : {}),
  });
  const selectionLayer =
    input.useSelectionLive === true
      ? T3ConfigSelectionLive.pipe(Layer.provide(environmentLayer))
      : Layer.succeed(T3ConfigSelection)({
          getSelectedEnvironment: () => Effect.succeed(input.selection),
        });

  return T3ConfigLive.pipe(
    Layer.provide(T3CredentialCryptoLive),
    Layer.provide(
      Layer.mergeAll(
        environmentLayer,
        selectionLayer,
        T3CredentialCipherWebLive,
        unavailableKeystoreFactoryLayer,
      ),
    ),
  );
}

export function t3ConfigLayerTest(homeDir: string, input: T3ConfigLayerTestInput = {}) {
  return Layer.mergeAll(ConfigPlatformLayer, t3ConfigDepsLayer(homeDir, input));
}

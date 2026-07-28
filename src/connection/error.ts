import * as Schema from "effect/Schema";

import { RemoteEnvironmentAuthErrorSchema } from "../auth/remote-error.ts";
import { ConfigError } from "../config/error.ts";
import { UrlError } from "../config/url/error.ts";

export class T3CodeConnectionError extends Schema.TaggedErrorClass<T3CodeConnectionError>()(
  "T3CodeConnectionError",
  {
    message: Schema.String,
    cause: Schema.Union([ConfigError, RemoteEnvironmentAuthErrorSchema, UrlError]),
  },
) {}

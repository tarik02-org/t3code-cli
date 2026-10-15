import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

type ExitSchema = Schema.Exit<Schema.Top, Schema.Top, Schema.Top>;

const isExitSchema = (schema: Schema.Top): schema is ExitSchema =>
  SchemaAST.isDeclaration(schema.ast) &&
  schema.ast.annotations?.expected === "Exit" &&
  "value" in schema &&
  "error" in schema &&
  "defect" in schema;

const AnyExit = Schema.declare((input): input is Exit.Exit<unknown, unknown> => Exit.isExit(input));

// `Schema.toCodecJson` checks an `Exit`'s value against its encoded form before decoding it,
// which skips `Schema.catchDecoding`. Upstream contracts rely on that to drop entries a server
// knows but this build does not (such as a fork's keybinding commands), so a newer or older
// server would fail every response that carries one. Decoding the value with its own codec
// keeps that recovery.
const exitCodecJson = (schema: ExitSchema) =>
  Schema.Union([
    Schema.Struct({
      _tag: Schema.Literal("Success"),
      value: Schema.toCodecJson(schema.value),
    }),
    Schema.Struct({
      _tag: Schema.Literal("Failure"),
      cause: Schema.toCodecJson(Schema.Cause(schema.error, schema.defect)),
    }),
  ]).pipe(
    Schema.decodeTo(
      AnyExit,
      SchemaTransformation.transform({
        decode: (encoded): Exit.Exit<unknown, unknown> =>
          "value" in encoded ? Exit.succeed(encoded.value) : Exit.failCause(encoded.cause),
        encode: (exit) =>
          Exit.isSuccess(exit)
            ? { _tag: "Success" as const, value: exit.value }
            : { _tag: "Failure" as const, cause: exit.cause },
      }),
    ),
  );

const codecFor: RpcSerialization.CodecFor = <S extends Schema.Top>(schema: S) => {
  if (!isExitSchema(schema)) {
    return RpcSerialization.json.codecFor(schema);
  }
  return exitCodecJson(schema);
};

export const layerJson = Layer.succeed(RpcSerialization.RpcSerialization)({
  ...RpcSerialization.json,
  codecFor,
});

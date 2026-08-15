{
  autoPatchelfHook,
  cacert,
  fetchPnpmDeps,
  installShellFiles,
  lib,
  libsecret,
  makeWrapper,
  nodejs_24,
  pnpm_10,
  pnpmConfigHook,
  runCommand,
  src,
  stdenv,
  upstreamSrc,
  writableTmpDirAsHomeHook,
}:

let
  nodejs = nodejs_24;
  pnpm = pnpm_10;
  version = (builtins.fromJSON (builtins.readFile "${src}/package.json")).version;
  sourceWithUpstream = runCommand "t3code-cli-${version}-source" { } ''
    cp --recursive --no-preserve=mode ${src} $out
    chmod --recursive u+w $out
    rm -rf $out/upstream-t3code
    cp --recursive --no-preserve=mode ${upstreamSrc} $out/upstream-t3code
  '';
in
stdenv.mkDerivation (finalAttrs: {
  pname = "t3code-cli";
  inherit version;
  src = sourceWithUpstream;
  strictDeps = true;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    fetcherVersion = 4;
    hash = "sha256-2bwrSxiSH8/S/JaB9aqNpNEmzLo5rSoIawIk8FONMMI=";
  };

  nativeBuildInputs = [
    autoPatchelfHook
    installShellFiles
    makeWrapper
    nodejs
    pnpm
    pnpmConfigHook
    writableTmpDirAsHomeHook
  ];

  buildInputs = [ libsecret ];

  noAuditTmpdir = true;
  SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    app="$out/libexec/t3code-cli"
    mkdir -p "$out/bin"
    pnpm --filter t3code-cli --config.inject-workspace-packages=true \
      deploy --prod --offline "$app"
    makeWrapper ${lib.getExe nodejs} "$out/bin/t3cli" \
      --add-flags "$app/dist/bin.js"
    installShellCompletion --cmd t3cli \
      --bash <($out/bin/t3cli --completions bash) \
      --fish <($out/bin/t3cli --completions fish) \
      --zsh <($out/bin/t3cli --completions zsh)

    runHook postInstall
  '';

  meta = {
    description = "Non-interactive CLI for T3 Code";
    homepage = "https://github.com/tarik02-org/t3code-cli";
    license = lib.licenses.mit;
    mainProgram = "t3cli";
    platforms = [ "x86_64-linux" ];
  };
})

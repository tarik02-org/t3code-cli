{
  description = "T3 Code CLI";

  nixConfig = {
    extra-substituters = [ "https://tarik02-t3code-cli.cachix.org" ];
    extra-trusted-public-keys = [
      "tarik02-t3code-cli.cachix.org-1:peiScdictfKPjHjL02GpaKqTcCS0tVZ79ixeMFdgqK0="
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    upstream-t3code = {
      url = "github:pingdotgg/t3code/cf3e714b0f58e29c8fa8660db50d2187e3263b65";
      flake = false;
    };
  };

  outputs =
    {
      nixpkgs,
      self,
      upstream-t3code,
    }:
    let
      source = nixpkgs.lib.fileset.toSource {
        root = ./.;
        fileset = nixpkgs.lib.fileset.difference ./. (nixpkgs.lib.fileset.maybeMissing ./upstream-t3code);
      };
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
    in
    {
      packages = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        rec {
          t3code-cli = pkgs.callPackage ./nix/package.nix {
            src = source;
            upstreamSrc = upstream-t3code;
          };

          default = t3code-cli;
        }
      );

      formatter = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.nixfmt
      );
    };
}

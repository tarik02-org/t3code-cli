{
  description = "T3 Code CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    upstream-t3code = {
      url = "github:pingdotgg/t3code/3b72d17cbca691f0b64e6d4a10c9e349f42873a5";
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
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {
      packages.${system} = rec {
        t3code-cli = pkgs.callPackage ./nix/package.nix {
          src = self;
          upstreamSrc = upstream-t3code;
        };

        default = t3code-cli;
      };

      formatter.${system} = pkgs.nixfmt;
    };
}

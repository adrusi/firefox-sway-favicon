{
  description = "Firefox extension + native host that forwards favicons to SwayFX";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    firefox-addons = {
      url = "gitlab:rycee/nur-expressions?dir=pkgs/firefox-addons";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, firefox-addons }: let
    systems = [ "x86_64-linux" "aarch64-linux" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems
      (system: f { inherit system; pkgs = nixpkgs.legacyPackages.${system}; });
  in {

    packages = forAllSystems ({ system, pkgs }: rec {

      # Signed XPI fetched from the GitHub release.
      # Update url + hash after each release.
      # default = pkgs.fetchurl {
      #   url  = "https://github.com/TODO/firefox-sway-favicon/releases/download/vX.Y.Z/sway_favicon-X.Y.Z.xpi";
      #   hash = "sha256-TODO";
      # };

      # The native messaging host: Python script + JSON manifest.
      # The manifest is at $out/lib/mozilla/native-messaging-hosts/sway_favicon.json
      native-host = pkgs.stdenvNoCC.mkDerivation {
        pname = "sway-favicon-native-host";
        version = "1.1.0";
        src = ./native-host;
        installPhase = ''
          runHook preInstall

          install -Dm755 sway_favicon_host.py \
            "$out/lib/sway-favicon/sway_favicon_host.py"

          substituteInPlace "$out/lib/sway-favicon/sway_favicon_host.py" \
            --replace '#!/usr/bin/env python3' \
                      '#!${pkgs.python3}/bin/python3'

          mkdir -p "$out/lib/mozilla/native-messaging-hosts"
          cat > "$out/lib/mozilla/native-messaging-hosts/sway_favicon.json" << EOF
          {
            "name": "sway_favicon",
            "description": "Sway favicon bridge",
            "path": "$out/lib/sway-favicon/sway_favicon_host.py",
            "type": "stdio",
            "allowed_extensions": ["sway-favicon@adrusi.com"]
          }
          EOF

          runHook postInstall
        '';
      };

      # Unsigned XPI built from source (for local testing / signing submission).
      # Installs to the standard Firefox extensions directory path so
      # home-manager's programs.firefox.profiles.<n>.extensions can use it.
      extension-unsigned = pkgs.stdenvNoCC.mkDerivation {
        pname = "sway-favicon-extension";
        version = "1.1.0";
        src = ./extension;
        nativeBuildInputs = [ pkgs.zip ];
        buildPhase = "zip -r sway_favicon.xpi .";
        installPhase = ''
          GECKO="{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
          install -Dm644 sway_favicon.xpi \
            "$out/share/mozilla/extensions/$GECKO/sway-favicon@adrusi.com.xpi"
        '';
      };

      extension = firefox-addons.lib.${system}.buildFirefoxXpiAddon {
        pname = "firefox-sway-favicon";
        version = "1.1.0";
        addonId = "sway-favicon@adrusi.com";
        url = "https://github.com/adrusi/firefox-sway-favicon/releases/download/v1.1.0/sway-favicon.xpi";
        sha256 = "0i4hhd56kw7jg2ix0l5kvqfibnfn181jfrjrmpzwvvwhz2pqxnaa";
        meta = with pkgs.lib; {
          homepage = "https://github.com/adrusi/firefox-sway-favicon";
          description = "Sends tab favicons to SwayFX via native messaging";
          license = licenses.mit;
          platforms = platforms.all;
          mozPermissions = [ "tabs" "nativeMessaging" "<all_urls>" ];
        };
      };

      default = extension;
    });
  };
}

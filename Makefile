BUNDLE_PATH = "tailscale@joaophi.github.com.zip"
EXTENSION_DIR = "tailscale@joaophi.github.com"

all: build install

.PHONY: all build install enable run clean

build:
	rm -f $(BUNDLE_PATH); \
	cd $(EXTENSION_DIR); \
	gnome-extensions pack --force --podir=locale \
	                      --extra-source=icons/ \
	                      --extra-source=tailscale.js \
	                      --extra-source=timeout.js \
	                      --extra-source=compat.js; \
	mv $(EXTENSION_DIR).shell-extension.zip ../$(BUNDLE_PATH)

install:
	gnome-extensions install $(BUNDLE_PATH) --force

enable:
	dbus-run-session -- gnome-extensions enable tailscale@joaophi.github.com

run:
	@if gnome-shell --help | grep -q -- '--devkit'; then \
		dbus-run-session -- gnome-shell --devkit --wayland; \
	else \
		dbus-run-session -- gnome-shell --nested --wayland; \
	fi

clean:
	@rm -fv $(BUNDLE_PATH)

# tailscale-gnome-qs

[<img alt="" height="100" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true">](https://extensions.gnome.org/extension/6139/tailscale-qs/)

Supported GNOME Shell versions: 45, 46, 47, 48, 49.

##### BUILD (UBUNTU)

```bash
sudo apt update && sudo apt install make gettext gnome-shell
make build
make install
```

Prerequisites:
- `tailscaled` must be installed and running on the host.
- Your user must be allowed to talk to the local Tailscale socket.

##### DEVELOPMENT

```bash
make run
```

`make run` uses `gnome-shell --devkit --wayland` when available, and falls back to `--nested --wayland` on older GNOME Shell releases.

##### CONFIG
Make sure your user is allowed to manage the local Tailscale daemon:

```bash
sudo tailscale set --operator=$USER
```

This grants your user permission to access the local API exposed by `tailscaled`, which this extension uses for status, preferences and profile changes.

If the extension cannot reach the local API, the quick settings menu now shows the daemon or permission error directly. The most common fix is still:

```bash
sudo tailscale set --operator=$USER
```

##### SCREENSHOT

![image](https://github.com/joaophi/tailscale-gnome-qs/assets/23062105/b4209a00-0cd8-45bd-869a-e2a0a7cfdb81)

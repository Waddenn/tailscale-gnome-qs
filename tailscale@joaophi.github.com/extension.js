/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";

// This is the live instance of the Quick Settings menu
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

import { Tailscale } from "./tailscale.js";
import { clearInterval, clearSources, setInterval } from "./timeout.js";

function bindVisibility(target, tailscale) {
  const updateVisibility = () => {
    target.visible = tailscale.running;
  };

  tailscale.connect("notify::running", updateVisibility);
  updateVisibility();
}

function showOsd(icon, label) {
  const osd = Main.osdWindowManager;

  if (osd.showOne) {
    osd.showOne(-1, icon, label);
    return;
  }

  osd.show(-1, icon, label);
}

function getNodeCountryLabel(node) {
  return node.location?.Country || node.location?.CountryCode || _("Other");
}

function getNodeIconName(node) {
  return !node.online
    ? "network-offline-symbolic"
    : ((node.os == "android" || node.os == "iOS")
      ? "phone-symbolic"
      : (node.mullvad
        ? "network-vpn-symbolic"
        : "computer-symbolic"));
}

const TailscaleIndicator = GObject.registerClass(
  class TailscaleIndicator extends QuickSettings.SystemIndicator {
    _init(icon, tailscale) {
      super._init();

      // Create the icon for the indicator
      const up = this._addIndicator();
      up.gicon = icon;
      tailscale.bind_property("running", up, "visible", GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);

      // Create the icon for the indicator
      const exit = this._addIndicator();
      exit.icon_name = "network-vpn-symbolic";
      const setVisible = () => { exit.visible = tailscale.running && tailscale.exit_node != ""; }
      tailscale.connect("notify::exit-node", () => setVisible());
      tailscale.connect("notify::running", () => setVisible());
      setVisible();
    }
  }
);

const TailscaleDeviceItem = GObject.registerClass(
  class TailscaleDeviceItem extends PopupMenu.PopupBaseMenuItem {
    _init(icon_name, text, subtitle, onClick, onLongClick) {
      super._init({
        activate: Boolean(onClick),
      });

      const icon = new St.Icon({
        style_class: 'popup-menu-icon',
      });
      this.add_child(icon);
      icon.icon_name = icon_name;

      const label = new St.Label({
        x_expand: true,
      });
      this.add_child(label);
      label.text = text;

      const sub = new St.Label({
        style_class: 'device-subtitle',
      });
      this.add_child(sub);
      sub.text = subtitle;

      if (onClick)
        this.connect('activate', () => onClick());

      if (Clutter.LongPressGesture) {
        const longPressGesture = new Clutter.LongPressGesture();
        longPressGesture.connect('recognize', () => onLongClick?.());
        this.add_action(longPressGesture);

        const clickGesture = new Clutter.ClickGesture({
          recognize_on_press: false,
        });
        clickGesture.connect('recognize', () => {
          this.activate(Clutter.get_current_event());
        });
        this.add_action(clickGesture);
      } else {
        const clickAction = this._clickAction ?? (() => {
          const action = new Clutter.ClickAction();
          this.add_action(action);
          action.connect('notify::pressed', () => {
            if (action.pressed)
              this.add_style_pseudo_class('active');
            else
              this.remove_style_pseudo_class('active');
          });
          action.connect('clicked', () => this.activate(Clutter.get_current_event()));
          return action;
        })();
        clickAction.connect('long-press', (_action, _actor, state) => {
          if (state === Clutter.LongPressState.ACTIVATE)
            return onLongClick?.() ?? false;

          return true;
        });
        clickAction.enabled = true;
      }
    }

    activate(event) {
      if (this._activatable)
        this.emit('activate', event);
    }

    vfunc_button_press_event() { }

    vfunc_button_release_event() { }

    vfunc_touch_event(touchEvent) { }
  }
);

const TailscaleProfileItem = GObject.registerClass(
  class TailscaleProfileItem extends PopupMenu.PopupBaseMenuItem {
    _init(title, subtitle, enabled, onClick) {
      super._init({
        activate: onClick,
      });

      const label = new St.Label({
        x_expand: true,
      });
      this.add_child(label);
      label.text = title;

      const sub = new St.Label({
        style_class: 'device-subtitle',
      });
      this.add_child(sub);
      sub.text = subtitle;

      if (enabled) {
        const icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(icon);
        icon.icon_name = 'object-select-symbolic'
      }

      this.connect('activate', () => onClick());
    }

    activate(event) {
      if (this._activatable)
        this.emit('activate', event);
    }
  }
);

const TailscaleInfoItem = GObject.registerClass(
  class TailscaleInfoItem extends PopupMenu.PopupBaseMenuItem {
    _init(text) {
      super._init({
        activate: false,
      });

      const label = new St.Label({
        text,
        x_expand: true,
        style_class: 'dim-label',
      });
      this.add_child(label);
      this._label = label;
    }

    setText(text) {
      this._label.text = text;
    }
  }
);

const TailscaleExpanderItem = GObject.registerClass(
  class TailscaleExpanderItem extends PopupMenu.PopupBaseMenuItem {
    _init(text, expanded, onToggle) {
      super._init({
        activate: false,
      });

      const label = new St.Label({
        text,
        x_expand: true,
      });
      this.add_child(label);

      this._icon = new St.Icon({
        style_class: 'popup-menu-icon',
        icon_name: expanded ? 'pan-down-symbolic' : 'pan-end-symbolic',
      });
      this.add_child(this._icon);

      if (Clutter.ClickGesture) {
        const clickGesture = new Clutter.ClickGesture({
          recognize_on_press: false,
        });
        clickGesture.connect('recognize', () => onToggle());
        this.add_action(clickGesture);
      } else {
        const clickAction = new Clutter.ClickAction();
        this.add_action(clickAction);
        clickAction.connect('notify::pressed', () => {
          if (clickAction.pressed)
            this.add_style_pseudo_class('active');
          else
            this.remove_style_pseudo_class('active');
        });
        clickAction.connect('clicked', () => onToggle());
      }
    }

    setExpanded(expanded) {
      this._icon.icon_name = expanded ? 'pan-down-symbolic' : 'pan-end-symbolic';
    }
  }
);

const PopupScrollableSubMenuMenuItem = GObject.registerClass(
  class PopupScrollableSubMenuMenuItem extends PopupMenu.PopupSubMenuMenuItem {
    _init(...args) {
      super._init(...args);

      this.menu._needsScrollbar = () => true;
      this.menu.box.height = 200;
    }
  }
);

const TailscaleMenuToggle = GObject.registerClass(
  class TailscaleMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(icon, tailscale) {
      super._init({
        label: _("Tailscale"),
        gicon: icon,
        toggleMode: true,
        menuEnabled: true,
      });

      this.title = _("Tailscale");
      this.subtitle = _("Disconnected");
      tailscale.bind_property("running", this, "checked", GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL);

      // This function is unique to this class. It adds a nice header with an
      // icon, title and optional subtitle. It's recommended you do so for
      // consistency with other menus.
      const updateHeader = () => {
        this.subtitle = tailscale.running
          ? (tailscale.exit_node_name || _("Connected"))
          : _("Disconnected");
        this.menu.setHeader(icon, this.title, this.subtitle);
      };
      tailscale.connect("notify::exit-node-name", updateHeader);
      tailscale.connect("notify::running", updateHeader);
      updateHeader();

      const errorItem = new TailscaleInfoItem("");
      const updateError = obj => {
        const hasError = Boolean(obj.last_error);
        errorItem.visible = hasError;
        errorItem.setText(hasError ? obj.last_error : "");
      };
      tailscale.connect("notify::last-error", updateError);
      updateError(tailscale);
      this.menu.addMenuItem(errorItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // NODES
      const mnodes = new PopupScrollableSubMenuMenuItem(_("Nodes"), false, {});
      const nodes = new PopupMenu.PopupMenuSection();
      const mmullvad = new PopupScrollableSubMenuMenuItem(_("Mullvad"), false, {});
      const mullvadNodes = new PopupMenu.PopupMenuSection();
      const countryExpansionState = new Map();
      const createNodeItem = node => {
        const subtitle = node.exit_node ? _("disable exit node") : (node.exit_node_option ? _("use as exit node") : "");
        const onClick = node.exit_node_option ? () => { tailscale.exit_node = node.exit_node ? "" : node.id; } : null;
        const onLongClick = () => {
          if (!node.ips)
            return false;

          St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.ips[0]);
          St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, node.ips[0]);
          showOsd(icon, _("IP address has been copied to the clipboard"));
          return true;
        };

        return new TailscaleDeviceItem(getNodeIconName(node), node.name, subtitle, onClick, onLongClick);
      };
      const addGroupedNodes = (section, sectionNodes) => {
        const countryGroups = new Map();

        for (const node of sectionNodes) {
          const country = getNodeCountryLabel(node);
          if (!countryGroups.has(country))
            countryGroups.set(country, []);
          countryGroups.get(country).push(node);
        }

        const countries = [...countryGroups.keys()].sort((a, b) => {
          const aActive = countryGroups.get(a).some(node => node.exit_node);
          const bActive = countryGroups.get(b).some(node => node.exit_node);
          return (bActive - aActive) || a.localeCompare(b);
        });

        for (const country of countries) {
          const countryNodes = countryGroups.get(country);
          const stateKey = `${section === mullvadNodes ? "mullvad" : "nodes"}:${country}`;
          const defaultExpanded = countryNodes.some(node => node.exit_node);
          let expanded = countryExpansionState.get(stateKey);
          if (expanded === undefined)
            expanded = defaultExpanded;

          const countrySection = new PopupMenu.PopupMenuSection();
          const countryItem = new TailscaleExpanderItem(country, expanded, () => {
            expanded = !expanded;
            countryExpansionState.set(stateKey, expanded);
            countryItem.setExpanded(expanded);
            countrySection.actor.visible = expanded;
          });

          for (const node of countryNodes)
            countrySection.addMenuItem(createNodeItem(node));

          countryExpansionState.set(stateKey, expanded);
          countrySection.actor.visible = expanded;
          section.addMenuItem(countryItem);
          section.addMenuItem(countrySection);
        }
      };
      const updateNodes = obj => {
        nodes.removeAll();
        mullvadNodes.removeAll();
        const standardNodes = obj.nodes.filter(node => !node.mullvad);
        const mullvadNodeList = obj.nodes.filter(node => node.mullvad);
        const hasMullvadNodes = mullvadNodeList.length > 0;

        if (!standardNodes.length) {
          nodes.addMenuItem(new TailscaleInfoItem(_("No devices available")));
        } else {
          addGroupedNodes(nodes, standardNodes);
        }

        if (hasMullvadNodes)
          addGroupedNodes(mullvadNodes, mullvadNodeList);

        mmullvad.visible = hasMullvadNodes;
      }
      tailscale.connect("notify::nodes", obj => updateNodes(obj));
      updateNodes(tailscale);
      mnodes.menu.addMenuItem(nodes);
      this.menu.addMenuItem(mnodes);
      mmullvad.menu.addMenuItem(mullvadNodes);
      this.menu.addMenuItem(mmullvad);
      bindVisibility(mnodes, tailscale);
      bindVisibility(mmullvad, tailscale);

      // PREFS
      const prefs = new PopupMenu.PopupSubMenuMenuItem(_("Settings"), false, {});

      const routes = new PopupMenu.PopupSwitchMenuItem(_("Accept routes"), tailscale.accept_routes, {});
      tailscale.connect("notify::accept-routes", (obj) => routes.setToggleState(obj.accept_routes));
      routes.connect("toggled", (item) => tailscale.accept_routes = item.state);
      prefs.menu.addMenuItem(routes);

      const dns = new PopupMenu.PopupSwitchMenuItem(_("Accept DNS"), tailscale.accept_dns, {});
      tailscale.connect("notify::accept-dns", (obj) => dns.setToggleState(obj.accept_dns));
      dns.connect("toggled", (item) => tailscale.accept_dns = item.state);
      prefs.menu.addMenuItem(dns);

      const lan = new PopupMenu.PopupSwitchMenuItem(_("Allow LAN access"), tailscale.allow_lan_access, {});
      tailscale.connect("notify::allow-lan-access", (obj) => lan.setToggleState(obj.allow_lan_access));
      lan.connect("toggled", (item) => tailscale.allow_lan_access = item.state);
      prefs.menu.addMenuItem(lan);

      const shields = new PopupMenu.PopupSwitchMenuItem(_("Shields up"), tailscale.shields_up, {});
      tailscale.connect("notify::shields-up", (obj) => shields.setToggleState(obj.shields_up));
      shields.connect("toggled", (item) => tailscale.shields_up = item.state);
      prefs.menu.addMenuItem(shields);

      const ssh = new PopupMenu.PopupSwitchMenuItem(_("SSH"), tailscale.ssh, {});
      tailscale.connect("notify::ssh", (obj) => ssh.setToggleState(obj.ssh));
      ssh.connect("toggled", (item) => tailscale.ssh = item.state);
      prefs.menu.addMenuItem(ssh);

      this.menu.addMenuItem(prefs);
      bindVisibility(prefs, tailscale);

      // PROFILES
      const profiles = new PopupMenu.PopupSubMenuMenuItem(_("Profiles"), false, {});
      const updateProfiles = obj => {
        profiles.menu.removeAll();
        if (!obj.profiles.length) {
          profiles.menu.addMenuItem(new TailscaleInfoItem(_("No profiles available")));
          return;
        }

        for (const p of obj.profiles) {
          const currentProfileId = obj._prefs?.Config?.UserProfile?.ID ?? null;
          const currentControlUrl = obj._prefs?.ControlURL ?? null;
          const enabled = currentControlUrl === p.ControlURL && currentProfileId === p.UserProfile?.ID;
          const onClick = () => { tailscale.profiles = p.ID; };
          profiles.menu.addMenuItem(new TailscaleProfileItem(
            p.Name ?? _("Unknown profile"),
            p.NetworkProfile?.DomainName ?? "",
            enabled,
            onClick,
          ));
        }
      };
      tailscale.connect("notify::profiles", obj => updateProfiles(obj));
      updateProfiles(tailscale);
      this.menu.addMenuItem(profiles);
      bindVisibility(profiles, tailscale);
    }
  }
);

export default class TailscaleExtension extends Extension {
  enable() {
    const icon = Gio.icon_new_for_string(`${this.path}/icons/tailscale-symbolic.svg`);

    this._tailscale = new Tailscale();
    this._indicator = new TailscaleIndicator(icon, this._tailscale);
    this._menu = new TailscaleMenuToggle(icon, this._tailscale);
    if (QuickSettingsMenu.addExternalIndicator) {
      this._indicator.quickSettingsItems.push(this._menu);
      QuickSettingsMenu.addExternalIndicator(this._indicator);
    } else {
      const timerHandle = setInterval(() => {
        if (!QuickSettingsMenu._indicators.get_first_child())
          return;

        QuickSettingsMenu._indicators.insert_child_at_index(this._indicator, 0);
        QuickSettingsMenu._addItems([this._menu]);
        QuickSettingsMenu.menu._grid.set_child_below_sibling(
          this._menu,
          QuickSettingsMenu._backgroundApps.quickSettingsItems[0]
        );

        clearInterval(timerHandle);
      }, 100);
    }
  }

  disable() {
    clearSources();

    if (this._menu) {
      this._menu.destroy();
      this._menu = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    if (this._tailscale) {
      this._tailscale.destroy();
      this._tailscale = null;
    }
  }
}

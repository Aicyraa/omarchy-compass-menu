# Menu

`jee.menu`, a clone of the built-in `omarchy.menu`. The shell routes every
`omarchy.menu` call here (`clonedFrom`), so keybinds, the bar button,
`omarchy menu ...` and `omarchy-menu-select` / `-input` all land on this plugin.

## Using it

- `SUPER + SPACE` opens Home: recents, three toggles and root-level actions
- `Up` / `Down` on the rail previews a category; `Right`, `Enter` or `Tab` steps in
- Only `Enter` runs anything. `Right` steps into submenus and does nothing else
- Toggles flip in place and leave the menu open
- `Left` or `Backspace` goes back; `Esc` clears the search, then closes
- Typing from the rail searches everything; typing inside a menu searches that menu
- `Delete` on a Home row forgets it. In Apps or search it still offers uninstall
- Click a breadcrumb to jump back up

## Developing

Edit here, run `node test.js`, then `python3 deploy.py && omarchy restart shell`.
The plugin is `keepLoaded`, so hot reload is not enough. Never send `wtype` keys to
the live menu: it takes the keyboard, so real typing lands in its search.

- Items still come from `default/omarchy/omarchy-menu.jsonc` and the user file at
  `~/.config/omarchy/extensions/omarchy-menu.jsonc`.
- Use counts live in `~/.local/state/jee-menu-recent.json`, fading with a one-week
  half-life. `system.*` and `remove.*` are never recorded. Only menu use counts:
  a keybind that runs a command directly never passes through here.
- Shortcut hints come from parsing `default/hypr/bindings/*.lua` and the user's
  `bindings.lua`. Stock toggles have no state, so `TOGGLE_GUARDS` adds it for three.
- The menu hangs from the top edge under the bar clock and opens the way the control
  center does: the clock's pill stretches sideways, then drops, and closing runs that
  backwards. The numbers are the control center's, so change them in both. There is no
  scrim, and the blur comes from the `omarchy-menu` layer rule in
  `~/.config/hypr/looknfeel.lua`.
- Apps come from the menu's own `AppLibrary`, not `shell.appLibrary`. The shell never
  gives a clone its library: `manifestHasKind` fails on the manifest it gets from the
  panel model. If `childCount apps` is 0, that path is the first thing to check.
- Dmenu mode keeps the stock narrow card, centered. About 20 Omarchy scripts depend on it.
- This is a copy, so upstream fixes to `omarchy.menu` do not arrive by themselves.
  Compare against `/usr/share/omarchy/shell/plugins/menu/` after updates.

The menu is not on the bar, so `shell.json` must list it under `plugins`. A plugin
with a bar-widget kind that is in neither place gets disabled.

## Removing it

`omarchy plugin disable jee.menu`, or restore the `.bak-menu-*` copy of
`~/.config/omarchy/shell.json`.

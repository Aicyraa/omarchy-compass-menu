function stripJsonc(raw) {
  return String(raw || "")
    .replace(/^\s*\/\/[^\n]*(\n|$)/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.filter(function(v) { return v })
  if (typeof value === "string" && value) return [value]
  return []
}

function normalizeItem(id, raw) {
  var value = raw || {}
  var aliases = normalizeAliases(value.aliases)
  var parent = value.parent
  if (parent === undefined)
    parent = id.indexOf(".") >= 0 ? id.split(".").slice(0, -1).join(".") : "root"
  if (id === "root") parent = ""

  var kind = value.action ? "action" : (value.target ? "link" : "menu")

  return {
    id: id,
    parent: parent,
    kind: kind,
    icon: value.icon || "",
    iconFont: value.iconFont || "",
    label: value.label || id,
    title: value.title || "",
    target: value.target || "",
    description: value.description || "",
    action: value.action || "",
    provider: value.provider || "",
    aliases: aliases,
    when: value.when || "",
    checked: value.checked || ""
  }
}

function parseMenuJsonc(raw) {
  var stripped = stripJsonc(raw)
  if (!stripped.trim()) return []

  var parsed
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    return []
  }
  if (typeof parsed !== "object" || parsed === null) return []

  var source = (parsed.items && typeof parsed.items === "object" && !Array.isArray(parsed.items))
    ? parsed.items
    : parsed
  var out = []
  for (var id in source) {
    var entry = source[id]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    out.push(normalizeItem(id, entry))
  }
  return out
}

var TOGGLE_GUARDS = {
  "trigger.toggle.nightlight": "omarchy-toggle-nightlight --status | grep -q '\"enabled\":true'",
  "trigger.toggle.idle-lock": "omarchy-toggle-idle status | grep -q '\"enabled\":true'",
  "trigger.toggle.notifications": "! grep -Eq '\"dnd\": *true' \"$HOME/.local/state/omarchy/notifications.json\""
}

function mergeMenuSources(defaultItems, userItems) {
  var nextItems = ({})
  var nextOrder = []
  var sources = [defaultItems || [], userItems || []]

  for (var s = 0; s < sources.length; s++) {
    var src = sources[s]
    for (var i = 0; i < src.length; i++) {
      var entry = src[i]
      if (!entry || !entry.id) continue
      if (!nextItems[entry.id]) nextOrder.push(entry.id)
      var prior = nextItems[entry.id] || {}
      var merged = {}
      for (var k in prior) merged[k] = prior[k]
      for (var k2 in entry) merged[k2] = entry[k2]
      merged.id = entry.id
      nextItems[entry.id] = merged
    }
  }

  if (!nextItems.root) {
    nextItems.root = { id: "root", parent: "", kind: "menu", icon: "", iconFont: "", label: "Go", title: "", target: "", description: "", aliases: [], when: "", checked: "", action: "", provider: "" }
    nextOrder.unshift("root")
  }
  for (var k3 = 0; k3 < nextOrder.length; k3++) nextItems[nextOrder[k3]].order = k3

  // The shipped toggles carry no state, so give the common ones a way to show it.
  for (var toggle in TOGGLE_GUARDS) {
    if (nextItems[toggle] && !nextItems[toggle].checked) nextItems[toggle].checked = TOGGLE_GUARDS[toggle]
  }

  return {
    items: nextItems,
    itemOrder: nextOrder
  }
}

// Both merges below return fresh items/itemOrder objects for the caller to
// assign in one go. They must never write into the maps they are handed: those
// live in QML `var` properties, and an in-place write into such an object is
// occasionally dropped by the engine — the key lands with an undefined value.
// A lost write used to leave an id in itemOrder with no item behind it, and
// the next merge then kept that orphan and appended a second row for the same
// app, so the launcher listed it twice (and again on every later rescan).

// Swaps every app row for the current set. Rows keep the order they arrive in;
// ids already claimed (including duplicate desktop ids) are listed once.
function mergeAppRows(items, itemOrder, appRows) {
  var source = items || ({})
  var order = Array.isArray(itemOrder) ? itemOrder : []
  var rows = Array.isArray(appRows) ? appRows : []
  var nextItems = ({})
  var nextOrder = []

  for (var i = 0; i < order.length; i++) {
    var id = order[i]
    var existing = source[id]
    // Orphans (an id with no item) are dropped rather than carried forward,
    // so a single lost write cannot compound into a duplicate row.
    if (!existing || existing.kind === "app") continue
    nextItems[id] = existing
    nextOrder.push(id)
  }

  for (var j = 0; j < rows.length; j++) {
    var row = rows[j]
    if (!row || !row.id || nextItems[row.id]) continue
    row.order = nextOrder.length
    nextItems[row.id] = row
    nextOrder.push(row.id)
  }

  return { items: nextItems, itemOrder: nextOrder }
}

// Swaps the rows one provider contributed, leaving every other item untouched.
// Rows carry the id of the submenu that produced them, so a provider that runs
// again drops its previous batch — a plugin that was just enabled disappears
// from the Enable list — without disturbing static children declared in JSONC.
function swapProviderRows(items, itemOrder, menuId, rows) {
  var source = items || ({})
  var order = Array.isArray(itemOrder) ? itemOrder : []
  var incoming = Array.isArray(rows) ? rows : []
  var nextItems = ({})
  var nextOrder = []

  for (var i = 0; i < order.length; i++) {
    var id = order[i]
    var existing = source[id]
    if (!existing || existing.providerMenu === menuId) continue
    nextItems[id] = existing
    nextOrder.push(id)
  }

  for (var j = 0; j < incoming.length; j++) {
    var row = incoming[j]
    if (!row || !row.id || nextItems[row.id]) continue
    row.providerMenu = menuId
    row.order = nextOrder.length
    nextItems[row.id] = row
    nextOrder.push(row.id)
  }

  return { items: nextItems, itemOrder: nextOrder }
}

function item(items, id) {
  return items && items[id] ? items[id] : null
}

// Routes may name a real id (`system`, `setup.power`) or an alias declared in
// JSONC (`power-menu`, `settings`). An exact id beats any alias, and app rows
// are never routable: their aliases carry .desktop Keywords and GenericName
// for search, so an installed application could otherwise shadow a menu route
// (htop ships `Keywords=system;...`). Unknown strings fall through as the
// literal input so misspellings still attempt to open that id.
function resolveRoute(items, itemOrder, input) {
  var raw = String(input || "").toLowerCase().replace(/_/g, "-")
  if (!raw || raw === "go" || raw === "menu") return "root"
  if (item(items, raw)) return raw
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var entry = item(items, order[i])
    if (!entry || entry.kind === "app" || !entry.aliases) continue
    for (var j = 0; j < entry.aliases.length; j++) {
      var alias = String(entry.aliases[j] || "").toLowerCase().replace(/_/g, "-")
      if (alias === raw) return entry.id
    }
  }
  return raw
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item"
}

function depthFor(items, id) {
  var depth = 0
  var current = item(items, id)
  var guard = 0

  while (current && current.parent && current.parent !== "root" && guard < 32) {
    depth += 1
    current = item(items, current.parent)
    guard += 1
  }

  return depth
}

function pathFor(items, id) {
  var labels = []
  var current = item(items, id)
  var guard = 0

  while (current && current.id !== "root" && guard < 32) {
    labels.unshift(current.label)
    current = item(items, current.parent)
    guard += 1
  }

  return labels.join(" › ")
}

function parentPathFor(items, id) {
  var entry = item(items, id)
  if (!entry || !entry.parent || entry.parent === "root") return ""
  return pathFor(items, entry.parent)
}

function isDescendantOf(items, id, ancestorId) {
  if (ancestorId === "root") return id !== "root"

  var current = item(items, id)
  var guard = 0
  while (current && current.parent && guard < 32) {
    if (current.parent === ancestorId) return true
    current = item(items, current.parent)
    guard += 1
  }

  return false
}

function childCount(items, itemOrder, id) {
  var count = 0
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var entry = item(items, order[i])
    if (entry && entry.parent === id) count += 1
  }
  return count
}

function isVisible(items, itemOrder, whenResults, entry, depth) {
  if (!entry) return false
  if (entry.when && whenResults && whenResults[entry.id] === false) return false
  if (entry.kind !== "menu" && entry.kind !== "link") return true
  if (entry.provider) return true

  var guard = depth || 0
  if (guard >= 32) return false

  var target = entry.kind === "link" ? entry.target : entry.id
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var child = item(items, order[i])
    if (child && child.parent === target && isVisible(items, itemOrder, whenResults, child, guard + 1)) return true
  }

  return false
}

function labelFor(entry, checkedResults) {
  if (!entry) return ""
  if (entry.checked && checkedResults && checkedResults[entry.id]) return entry.label + " ✓"
  return entry.label
}

function searchableToken(value) {
  return String(value || "").replace(/[._-]+/g, " ")
}

function leafIdFor(id) {
  var parts = String(id || "").split(".")
  return parts.length > 0 ? parts[parts.length - 1] : id
}

function nameSearchText(entry) {
  if (!entry) return ""
  var aliases = []
  var values = Array.isArray(entry.aliases) ? entry.aliases : []
  for (var i = 0; i < values.length; i++) aliases.push(searchableToken(values[i]))
  return [entry.label, searchableToken(leafIdFor(entry.id)), aliases.join(" ")].join(" ").toLowerCase()
}

function termInSearchWords(term, text) {
  var words = String(text || "").toLowerCase().split(/\s+/)
  for (var i = 0; i < words.length; i++) {
    if (words[i] === term) return true
  }
  return false
}

function descriptionTextMatches(query, text) {
  var terms = String(query || "").toLowerCase().trim().split(/\s+/)
  for (var i = 0; i < terms.length; i++) {
    if (terms[i] && !termInSearchWords(terms[i], text)) return false
  }
  return true
}

// Indexes in text that spell term in order, or null. A literal run wins;
// otherwise the tightest spelling counts, and one strung out across a label is
// no match at all, so "thme" finds Theme but not "wiTH desktop + MicrophonE".
function fuzzyPositions(term, text) {
  var haystack = String(text || "").toLowerCase()
  var needle = String(term || "").toLowerCase()
  if (!needle) return []

  var exact = haystack.indexOf(needle)
  if (exact >= 0) {
    var run = []
    for (var r = 0; r < needle.length; r++) run.push(exact + r)
    return run
  }

  var best = null
  var start = haystack.indexOf(needle.charAt(0))
  while (start >= 0) {
    var positions = [start]
    for (var i = 1; i < needle.length; i++) {
      var at = haystack.indexOf(needle.charAt(i), positions[i - 1] + 1)
      if (at < 0) break
      positions.push(at)
    }
    if (positions.length === needle.length) {
      var span = positions[positions.length - 1] - start
      if (!best || span < best[best.length - 1] - best[0]) best = positions
    }
    start = haystack.indexOf(needle.charAt(0), start + 1)
  }

  if (!best || best[best.length - 1] - best[0] > needle.length + 1) return null
  return best
}

// Short terms stay literal: a two-letter subsequence matches half the menu.
function fuzzyMatches(term, text) {
  return term.length >= 3 && fuzzyPositions(term, text) !== null
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Styled text for a row label with each query term's letters picked out. Bold
// carries it on themes whose accent sits close to the text colour.
function highlightLabel(label, query, color) {
  var text = String(label || "")
  var terms = String(query || "").trim().split(/\s+/)
  var marked = ({})
  for (var i = 0; i < terms.length; i++) {
    var positions = terms[i] ? fuzzyPositions(terms[i], text) : null
    if (!positions) continue
    for (var j = 0; j < positions.length; j++) marked[positions[j]] = true
  }

  var html = ""
  for (var k = 0; k < text.length; k++) {
    var chr = escapeHtml(text.charAt(k))
    html += marked[k] ? "<b><font color=\"" + color + "\">" + chr + "</font></b>" : chr
  }
  return html
}

function matchesQuery(entry, query, visible) {
  if (!entry || entry.id === "root") return false
  if (!visible) return false

  var nameText = nameSearchText(entry)
  var descriptionText = String(entry.description || "").toLowerCase()
  var terms = String(query || "").toLowerCase().trim().split(/\s+/)

  for (var i = 0; i < terms.length; i++) {
    if (!terms[i]) continue
    if (nameText.indexOf(terms[i]) >= 0) continue
    if (termInSearchWords(terms[i], descriptionText)) continue
    if (fuzzyMatches(terms[i], entry.label)) continue
    return false
  }

  return true
}

function searchScore(items, entry, query) {
  var needle = String(query || "").toLowerCase().trim()
  var label = entry.label.toLowerCase()
  var nameText = nameSearchText(entry)
  var descriptionText = String(entry.description || "").toLowerCase()
  var score = 80

  if (label === needle) score = entry.parent === "root" ? 2 : 0
  // An installed app whose name contains the query as a whole word ("zen"
  // for Zen Browser) beats exact-labeled menu entries like Install > Zen.
  else if (entry.kind === "app" && label.split(/\s+/).indexOf(needle) >= 0) score = 0
  else if (label.indexOf(needle) === 0) score = 10
  else if (label.indexOf(needle) >= 0) score = 30
  else if (nameText.indexOf(needle) >= 0) score = 40
  else if (descriptionTextMatches(needle, descriptionText)) score = 60
  else score = 70

  if (entry.kind === "menu" || entry.kind === "link") score -= 2
  // App rows sort after all menu items, so they lose the tiebreak below to an
  // equal match. Outrank those, but stay inside the tier so better ones win.
  if (entry.kind === "app") score -= 5
  // Installing is usually not what a search means, and removing never is.
  if (tagFor(entry.id) === "Install") score += 5
  if (tagFor(entry.id) === "Remove") score += 1000

  return score * 1000 + depthFor(items, entry.id) * 25 + entry.order
}

function displayRow(items, itemOrder, checkedResults, entry, detail, score, section) {
  var target = entry.kind === "link" ? entry.target : entry.id
  return {
    itemId: entry.id,
    kind: entry.kind,
    icon: entry.icon,
    iconFont: entry.iconFont || "",
    appIcon: entry.appIcon || "",
    appId: entry.appId || "",
    label: entry.label,
    tag: tagFor(entry.id),
    checked: !!(entry.checked && checkedResults && checkedResults[entry.id]),
    target: target,
    detail: detail || "",
    path: pathFor(items, entry.id),
    childCount: (entry.kind === "menu" || entry.kind === "link") ? childCount(items, itemOrder, target) : 0,
    action: entry.action || "",
    provider: entry.provider || "",
    score: score || 0,
    section: section || ""
  }
}

// Commands a `checked:` expression reads a value out of. Every sibling row
// asks the same one -- Defaults > Browser has seven rows all comparing
// against `omarchy-default-browser` -- so the batch runs it once and the rows
// read the captured answer.
//
// The capture has to be eager. These are read inside `$(...)`, and a value
// cached while one expression runs lives in that subshell only, so a lazy
// memo never survives to the expression after it.
var GUARD_READERS = [
  "omarchy-channel-current",
  "omarchy-default-agent",
  "omarchy-default-browser",
  "omarchy-default-editor",
  "omarchy-default-terminal",
  "omarchy-dns"
]

// Package and command presence account for most of what the guards ask, and
// asked one at a time they are almost all fork: the shipped menu spends over
// a second on them. Answer them inside the guard process instead. These
// shadow the real commands for the batch only, so they have to agree with
// them everywhere, including for no arguments at all (present is true of
// nothing, missing is not).
//
// `pacman -Q` resolves a name through what installed packages provide, not
// just what they are called -- with gvim installed it reports `vim` as
// present -- so the set has to carry provides too, or `install.editor.vim`
// comes back and offers to install what is already there. A version
// constraint (`bash>=1`) is not a name any set can answer, so it goes to
// pacman itself; no shipped guard writes one.
//
// `pacman -Qi` wraps a long list across continuation lines whenever COLUMNS
// is set in the environment, which a login shell may well have done, so the
// parser follows the indented lines rather than reading the first one and
// dropping half of what is installed.
function guardHelpers() {
  return 'declare -A __omarchy_pkgs=()\n'
    + 'mapfile -t __omarchy_pkg_names < <({ pacman -Qq; LC_ALL=C pacman -Qi'
    + " | awk '/^[A-Za-z]/ { provides = ($0 ~ /^Provides/); sub(/^[^:]*: /, \"\") }"
    + ' provides && $0 != "None" { n = split($0, p, " ");'
    + ' for (i = 1; i <= n; i++) { sub(/[<>=].*/, "", p[i]); print p[i] } }\'; } 2>/dev/null)\n'
    + 'for __omarchy_pkg in "${__omarchy_pkg_names[@]}"; do __omarchy_pkgs[$__omarchy_pkg]=1; done\n'
    + '__omarchy_pkg_has() { [[ -n ${__omarchy_pkgs[$1]-} ]] && return 0; '
    + '[[ $1 == *[\\<\\>=]* ]] && { pacman -Q "$1" &>/dev/null; return; }; return 1; }\n'
    + 'omarchy-pkg-present() { local p; for p in "$@"; do __omarchy_pkg_has "$p" || return 1; done; return 0; }\n'
    + 'omarchy-pkg-missing() { local p; for p in "$@"; do __omarchy_pkg_has "$p" || return 0; done; return 1; }\n'
    + 'omarchy-cmd-present() { local c; for c in "$@"; do command -v "$c" &>/dev/null || return 1; done; return 0; }\n'
    + 'omarchy-cmd-missing() { local c; for c in "$@"; do command -v "$c" &>/dev/null || return 0; done; return 1; }\n'
}

// Substitute the captured answer into the expression rather than shadowing
// the reader with a function. `$(reader)` and the variable holding what it
// printed are interchangeable -- both strip trailing newlines, both split the
// same way unquoted -- while a function would also catch `command -v reader`,
// `VAR=x reader`, and every other form, and answer those wrong. Anything but
// the plain substitution is left alone to run the real command.
function guardPrelude(guards) {
  var prelude = guardHelpers()

  for (var i = 0; i < GUARD_READERS.length; i++) {
    // The guards arrive already substituted, so what marks a reader as wanted
    // is the slot standing in for it, not the call it replaced.
    if (guards.indexOf(guardReaderSlot(i)) < 0) continue
    // `|| :` so a reader that exits nonzero cannot take the batch down with
    // it under a login shell that turned on errexit.
    prelude += "__omarchy_read_" + i + "=$(" + GUARD_READERS[i] + " 2>/dev/null) || :\n"
  }

  return prelude
}

function guardReaderSlot(index) {
  return "${__omarchy_read_" + index + "}"
}

function substituteGuardReaders(expression) {
  for (var i = 0; i < GUARD_READERS.length; i++)
    expression = expression.split("$(" + GUARD_READERS[i] + ")").join(guardReaderSlot(i))

  return expression
}

function guardLine(id, tag, expression) {
  return "if { " + substituteGuardReaders(expression) + "; } >/dev/null 2>&1; then echo "
    + id + ":" + tag + ":1; else echo " + id + ":" + tag + ":0; fi\n"
}

// One bash script for every `when:` and `checked:` in the menu, reporting
// `<id>:<w|c>:<0|1>` per line. Speed is the whole point: the menu opens on
// the last evaluation's answers, so however long this takes is how long a row
// can contradict the state it describes.
function guardScript(items) {
  var guards = ""
  var ids = Object.keys(items || {})

  for (var i = 0; i < ids.length; i++) {
    var entry = items[ids[i]]
    if (!entry) continue
    if (entry.when) guards += guardLine(ids[i], "w", entry.when)
    if (entry.checked) guards += guardLine(ids[i], "c", entry.checked)
  }

  return guards ? guardPrelude(guards) + guards : ""
}

// The root child a row lives under, which is the rail entry it lights up.
function topLevelFor(items, id) {
  var current = item(items, id)
  var guard = 0
  while (current && current.parent && current.parent !== "root" && guard < 32) {
    current = item(items, current.parent)
    guard += 1
  }
  return current && current.parent === "root" ? current.id : "root"
}

// Ancestors from the top down, excluding root, for the breadcrumb.
function crumbsFor(items, id) {
  var crumbs = []
  var current = item(items, id)
  var guard = 0
  while (current && current.id !== "root" && guard < 32) {
    crumbs.unshift({ id: current.id, label: current.title || current.label })
    current = item(items, current.parent)
    guard += 1
  }
  return crumbs
}

// Things that end the session or uninstall software never get to sit one
// keypress away on the home view.
function isRememberable(id) {
  return !/^(system|remove)(\.|$)/.test(String(id || ""))
}

// Rows that look alike across menus: Theme is a change, an install or a removal.
function tagFor(id) {
  var match = /^(install|remove)\./.exec(String(id || ""))
  if (!match) return ""
  return match[1] === "install" ? "Install" : "Remove"
}

function isRemoval(id) {
  return tagFor(id) === "Remove"
}

// A toggle is usually one of several changes, so it flips in place.
function keepsOpen(id) {
  return String(id || "").indexOf("trigger.toggle.") === 0
}

var USAGE_HALF_LIFE = 7 * 24 * 3600 * 1000
var USAGE_CAP = 64

// Uses, faded by a week-long half-life, so habit beats a one-off.
function frecency(record, now) {
  if (!record) return 0
  return record.n * Math.pow(0.5, Math.max(0, now - record.t) / USAGE_HALF_LIFE)
}

function topUsed(usage, limit, now) {
  var source = usage || ({})
  return Object.keys(source).sort(function(a, b) {
    return frecency(source[b], now) - frecency(source[a], now)
  }).slice(0, limit)
}

function recordUse(usage, id, now) {
  var source = usage || ({})
  var next = ({})
  for (var key in source) next[key] = source[key]
  next[id] = { n: (next[id] ? next[id].n : 0) + 1, t: now }

  var kept = ({})
  var ids = topUsed(next, USAGE_CAP, now)
  for (var i = 0; i < ids.length; i++) kept[ids[i]] = next[ids[i]]
  kept[id] = next[id]
  return kept
}

function forgetUse(usage, id) {
  var source = usage || ({})
  var next = ({})
  for (var key in source) if (key !== id) next[key] = source[key]
  return next
}

// Stays under one search tier: use reorders equal matches, not better ones.
function searchBoost(record, now) {
  return Math.min(900, Math.round(frecency(record, now) * 150))
}

// Accepts the older most-recent-first array as well.
function parseUsage(raw, now) {
  var parsed
  try { parsed = JSON.parse(raw) } catch (e) { return ({}) }
  if (Array.isArray(parsed)) {
    var migrated = ({})
    for (var i = 0; i < parsed.length; i++) migrated[parsed[i]] = { n: 1, t: now - i }
    return migrated
  }
  return parsed && typeof parsed === "object" ? parsed : ({})
}

function formatKeys(keys) {
  return String(keys).split("+").map(function(part) {
    var key = part.trim().toLowerCase()
    return key.charAt(0).toUpperCase() + key.slice(1)
  }).join(" ")
}

// command -> keys from Lua binding files read in load order, so a later
// hl.unbind or rebind wins. Commented lines don't count.
function parseBindings(text) {
  var byKey = ({})
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line.indexOf("--") === 0) continue
    var unbind = /^hl\.unbind\(\s*"([^"]+)"/.exec(line)
    if (unbind) { delete byKey[unbind[1]]; continue }
    var bind = /^o\.bind\(\s*"([^"]+)"\s*,\s*(?:"[^"]*"|nil)\s*,\s*"((?:[^"\\]|\\.)*)"/.exec(line)
    if (bind) byKey[bind[1]] = bind[2].replace(/\\"/g, '"')
  }

  var byCommand = ({})
  for (var keys in byKey) {
    if (/code:|XF86/.test(keys)) continue
    var command = byKey[keys]
    if (!byCommand[command] || keys.length < byCommand[command].length) byCommand[command] = keys
  }
  return byCommand
}

// id -> printable keys. Menus match on the route their binding opens.
function hintsFor(items, itemOrder, bindings) {
  var hints = ({})
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var entry = item(items, order[i])
    if (entry && entry.action && bindings[entry.action]) hints[entry.id] = formatKeys(bindings[entry.action])
  }
  for (var command in bindings) {
    var route = /^omarchy-menu toggle (\S+)$/.exec(command)
    if (!route) continue
    var id = resolveRoute(items, order, route[1])
    if (id !== "root" && item(items, id)) hints[id] = formatKeys(bindings[command])
  }
  return hints
}

if (typeof module !== "undefined") {
  module.exports = {
    guardReaders: GUARD_READERS,
    guardScript: guardScript,
    stripJsonc: stripJsonc,
    normalizeAliases: normalizeAliases,
    normalizeItem: normalizeItem,
    parseMenuJsonc: parseMenuJsonc,
    mergeMenuSources: mergeMenuSources,
    mergeAppRows: mergeAppRows,
    swapProviderRows: swapProviderRows,
    item: item,
    resolveRoute: resolveRoute,
    slugify: slugify,
    depthFor: depthFor,
    pathFor: pathFor,
    parentPathFor: parentPathFor,
    isDescendantOf: isDescendantOf,
    childCount: childCount,
    isVisible: isVisible,
    labelFor: labelFor,
    searchableToken: searchableToken,
    leafIdFor: leafIdFor,
    nameSearchText: nameSearchText,
    termInSearchWords: termInSearchWords,
    descriptionTextMatches: descriptionTextMatches,
    matchesQuery: matchesQuery,
    searchScore: searchScore,
    displayRow: displayRow,
    fuzzyPositions: fuzzyPositions,
    highlightLabel: highlightLabel,
    topLevelFor: topLevelFor,
    crumbsFor: crumbsFor,
    isRememberable: isRememberable,
    tagFor: tagFor,
    isRemoval: isRemoval,
    keepsOpen: keepsOpen,
    frecency: frecency,
    topUsed: topUsed,
    recordUse: recordUse,
    forgetUse: forgetUse,
    searchBoost: searchBoost,
    parseUsage: parseUsage,
    formatKeys: formatKeys,
    parseBindings: parseBindings,
    hintsFor: hintsFor
  }
}

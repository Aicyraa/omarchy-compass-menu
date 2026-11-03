const assert = require("assert")
const m = require("./MenuModel.js")
assert.deepEqual(m.fuzzyPositions("thme", "Theme"), [0, 1, 3, 4])
assert.deepEqual(m.fuzzyPositions("the", "Theme"), [0, 1, 2])
assert.equal(m.fuzzyPositions("xyz", "Theme"), null)
assert.equal(m.fuzzyPositions("thme", "With desktop + microphone audio"), null)
assert.equal(m.fuzzyPositions("thme", "RetroArch Game Launcher"), null)
assert.deepEqual(m.fuzzyPositions("scsh", "Screenshot scrsh"), [11, 12, 14, 15])
const item = { id: "style.theme", label: "Theme", description: "", aliases: [], parent: "style" }
assert.ok(m.matchesQuery(item, "thme", true))
assert.ok(!m.matchesQuery(item, "th x", true))
assert.ok(!m.matchesQuery({ ...item, label: "Reboot" }, "rt", true), "short terms stay literal")
assert.equal(m.highlightLabel("A&B", "b", "#fff"), 'A&amp;<b><font color="#fff">B</font></b>')
const items = { root: { id: "root", parent: "" }, a: { id: "a", parent: "root", label: "A" }, "a.b": { id: "a.b", parent: "a", label: "B" } }
assert.equal(m.topLevelFor(items, "a.b"), "a")
assert.equal(m.topLevelFor(items, "root"), "root")
assert.deepEqual(m.crumbsFor(items, "a.b").map(c => c.id), ["a", "a.b"])
assert.ok(!m.isRememberable("system.shutdown") && !m.isRememberable("remove.web") && m.isRememberable("style.theme") && m.isRememberable("systemd.x"))
assert.equal(m.tagFor("install.style.theme"), "Install")
assert.equal(m.tagFor("remove.theme"), "Remove")
assert.equal(m.tagFor("removed.x"), "")
assert.ok(m.keepsOpen("trigger.toggle.nightlight") && !m.keepsOpen("trigger.toggle"))

const base = { kind: "action", aliases: [], description: "", order: 1, label: "Theme" }
const fix = { root: { id: "root" }, style: { id: "style", parent: "root" }, install: { id: "install", parent: "root" }, remove: { id: "remove", parent: "root" } }
const score = (id, parent) => m.searchScore(fix, { ...base, id, parent }, "theme")
assert.ok(score("style.theme", "style") < score("install.theme", "install"))
assert.ok(score("install.theme", "install") < score("remove.theme", "remove"))

const now = 1e12, day = 864e5
let u = m.recordUse({}, "a", now)
u = m.recordUse(u, "a", now)
assert.equal(u.a.n, 2)
u = m.recordUse(u, "b", now)
assert.deepEqual(m.topUsed(u, 8, now), ["a", "b"], "habit beats last used")
assert.deepEqual(m.topUsed({ old: { n: 3, t: now - 28 * day }, fresh: { n: 1, t: now } }, 8, now), ["fresh", "old"], "old habits fade")
assert.deepEqual(Object.keys(m.forgetUse(u, "a")), ["b"])
assert.ok(m.searchBoost({ n: 1000, t: now }, now) < 1000, "a boost never crosses a tier")
assert.deepEqual(m.topUsed(m.parseUsage('["x","y"]', now), 8, now), ["x", "y"], "migrates the old array")
assert.deepEqual(m.parseUsage("nonsense", now), {})
let cap = {}
for (let i = 0; i < 80; i++) cap = m.recordUse(cap, "i" + i, now + i)
assert.ok(Object.keys(cap).length <= 65 && cap.i79)

const lua = [
  'o.bind("SUPER + SHIFT + CTRL + SPACE", "Theme menu", "omarchy-menu toggle theme")',
  'o.bind("SUPER + B", nil, "run \\"x\\"")',
  '-- o.bind("SUPER + Z", "Dead", "dead")',
  'o.bind("SUPER + Q", "Gone", "gone")',
  'hl.unbind("SUPER + Q")',
  'o.bind("XF86PowerOff", "Power", "power")',
].join("\n")
const b = m.parseBindings(lua)
assert.equal(b["omarchy-menu toggle theme"], "SUPER + SHIFT + CTRL + SPACE")
assert.equal(b['run "x"'], "SUPER + B")
assert.ok(!b.dead && !b.gone && !b.power)
assert.equal(m.formatKeys("SUPER + CTRL + S"), "Super Ctrl S")
const hi = { root: { id: "root" }, "style.theme": { id: "style.theme", aliases: ["theme"], parent: "style", kind: "menu" }, x: { id: "x", action: "gone", aliases: [] } }
assert.equal(m.hintsFor(hi, Object.keys(hi), b)["style.theme"], "Super Shift Ctrl Space")

const merged = m.mergeMenuSources([{ id: "trigger.toggle.nightlight", parent: "trigger.toggle", kind: "action", label: "N" }], [])
assert.ok(merged.items["trigger.toggle.nightlight"].checked)
console.log("ok")

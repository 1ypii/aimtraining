import { Instance, Entities, Console } from "cs_script/point_script";

const runTime = 60;
const countdown = 3;
const idleText = "shoot a cube on the left wall to start";
const modes = ["flick", "grid", "micro", "reflex", "speed", "track", "strafe"];
const moving = ["track", "strafe"];
const speedCount = 5;
const gridCount = 3;
const area = { minX: -420, maxX: 420, minY: 800, maxY: 900, minZ: 48, maxZ: 250 };
const trackY = 850;
const trackZ = 72;
const targetColor = { r: 255, g: 70, b: 45 };
const hitColor = { r: 255, g: 255, b: 255 };
const btnColor = { r: 70, g: 70, b: 70 };
const activeColor = { r: 235, g: 140, b: 45 };

let phase = "idle";
let mode = "";
let startAt = 0;
let endAt = 0;
let shots = 0;
let hits = 0;
let streak = 0;
let bestStreak = 0;
let missed = false;
let timeSum = 0;
let markAt = 0;
let bellAt = 0;
let shownSec = -1;
let prev = 0;
let flashUntil = 0;
let colorUntil = 0;
let reflexAt = 0;
let trackX = 0;
let trackVel = 0;
let trackGoal = 0;
let nextTurn = 0;

const up = new Map();
const hitAt = new Map();
const best = load();

function load() {
    const out = {};
    for (const m of modes) out[m] = 0;
    let saved;
    try {
        saved = JSON.parse(Instance.GetSaveData());
    } catch {
        return out;
    }
    if (!saved || typeof saved !== "object") return out;
    for (const m of modes) {
        const v = saved[m];
        if (Number.isInteger(v) && v >= 0 && v < 100000) out[m] = v;
    }
    return out;
}

function fire(name, input, value) {
    Entities.FireInput({ name: name, input: input, value: value });
}

function board(text) {
    fire("board", "SetMessage", text);
}

function hudVar(id, value) {
    const hud = Entities.FindByName("hud")[0];
    if (hud) hud.SetDialogVariableString(id, "v", String(value));
}

function hudShow(id, on) {
    const hud = Entities.FindByName("hud")[0];
    if (hud) hud.SetHasClass(id, "Hidden", !on);
}

function flash(text, secs) {
    const now = Instance.GetGameTime();
    hudVar("flash", text);
    hudShow("flash", true);
    flashUntil = now + secs;
    Instance.SetNextThink(now);
}

function tint(name, color) {
    const target = Entities.FindByName(name)[0];
    if (target && target.SetColor) target.SetColor(color);
}

function acc() {
    if (shots === 0) return 0;
    return Math.min(100, Math.round((hits / shots) * 100));
}

function rand(min, max) {
    return min + Math.random() * (max - min);
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function pick(avoid) {
    let pos;
    for (let n = 0; n < 20; n++) {
        pos = { x: rand(area.minX, area.maxX), y: rand(area.minY, area.maxY), z: rand(area.minZ, area.maxZ) };
        let ok = true;
        if (avoid && Math.hypot(pos.x - avoid.x, pos.z - avoid.z) < 200) ok = false;
        for (const other of up.values()) {
            if (Math.hypot(pos.x - other.x, pos.z - other.z) < 110) ok = false;
        }
        if (ok) break;
    }
    return pos;
}

function near(from) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(70, 170);
    return {
        x: clamp(from.x + Math.cos(angle) * dist, area.minX, area.maxX),
        y: from.y,
        z: clamp(from.z + Math.sin(angle) * dist, area.minZ, area.maxZ)
    };
}

function place(name, pos) {
    const target = Entities.FindByName(name)[0];
    if (!target) return;
    target.Teleport({ position: pos });
    target.FireInput({ input: "Enable" });
    up.set(name, pos);
}

function hide(name) {
    fire(name, "Disable");
    up.delete(name);
}

function hideAll() {
    for (const name of [...up.keys()]) hide(name);
}

function spawnSpeed() {
    for (let n = 1; n <= speedCount; n++) place("target.speed." + n, pick());
}

function records() {
    const lines = ["records"];
    for (const m of modes) lines.push(m + "  " + best[m]);
    fire("board.records", "SetMessage", lines.join("\n"));
}

function lastRun() {
    const lines = ["last run", mode, "hits  " + hits, "accuracy  " + acc() + "%"];
    if (!moving.includes(mode) && hits > 0) lines.push("avg time  " + Math.round((timeSum / hits) * 1000) + " ms");
    lines.push("best streak  " + bestStreak);
    fire("board.last", "SetMessage", lines.join("\n"));
}

function status(now) {
    const left = Math.max(0, Math.ceil(endAt - now));
    board(mode + "   " + left + "s   hits " + hits + "   acc " + acc() + "%   best " + best[mode]);
    hudVar("time", left);
    hudVar("hits", hits);
    hudVar("acc", acc() + "%");
    hudVar("streak", streak);
}

function start(m) {
    if (phase !== "idle" || !modes.includes(m)) return;
    const now = Instance.GetGameTime();
    mode = m;
    phase = "countdown";
    shots = 0;
    hits = 0;
    streak = 0;
    bestStreak = 0;
    missed = false;
    timeSum = 0;
    shownSec = -1;
    startAt = now + countdown;
    prev = now;

    tint("btn." + mode, activeColor);
    hudVar("mode", mode);
    hudVar("time", runTime);
    hudVar("hits", 0);
    hudVar("acc", "0%");
    hudVar("streak", 0);
    hudShow("bar", true);
    fire("snd.tick", "StartSound");
    Instance.SetNextThink(now);
}

function begin(now) {
    phase = "run";
    endAt = now + runTime;
    markAt = now;
    shownSec = -1;
    flash("go", 0.6);

    if (mode === "flick") place("target.flick", pick());
    if (mode === "micro") place("target.speed.1", pick());
    if (mode === "speed") spawnSpeed();
    if (mode === "reflex") reflexAt = now + 0.5;
    if (mode === "grid") {
        for (let n = 1; n <= gridCount; n++) place("target.grid." + n, pick());
    }
    if (moving.includes(mode)) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        trackX = 0;
        trackVel = 0;
        trackGoal = dir * (mode === "strafe" ? 230 : 200);
        nextTurn = now + (mode === "strafe" ? 0.5 : 1);
        place("target.track", { x: trackX, y: trackY, z: trackZ });
    }
}

function end() {
    hideAll();
    phase = "idle";
    hudShow("bar", false);
    fire("snd.tick", "StopSound");
    tint("btn." + mode, btnColor);
    tint("target.track", targetColor);
    colorUntil = 0;
}

function finish() {
    end();
    const newBest = hits > best[mode];
    if (newBest) {
        best[mode] = hits;
        Instance.SetSaveData(JSON.stringify(best));
    }
    board(mode + " done   hits " + hits + "   acc " + acc() + "%   best " + best[mode]);
    lastRun();
    records();
    fire("snd.end", "StartSound");
    flash(newBest ? "new best  " + hits : hits + " hits", 3);
}

function stop() {
    if (phase === "idle") return;
    end();
    board(idleText);
    hudShow("flash", false);
    flashUntil = 0;
}

function reset() {
    up.clear();
    hitAt.clear();
    phase = "idle";
    flashUntil = 0;
    colorUntil = 0;
    records();
}

function moveTrack(now, dt) {
    const strafe = mode === "strafe";
    if (now >= nextTurn) {
        if (strafe) {
            trackGoal = trackGoal > 0 ? -230 : 230;
            nextTurn = now + rand(0.25, 0.7);
        } else {
            const dir = Math.random() < 0.5 ? -1 : 1;
            trackGoal = dir * rand(140, 280);
            nextTurn = now + rand(0.7, 1.8);
        }
    }
    const step = (strafe ? 2400 : 700) * dt;
    if (trackVel < trackGoal) trackVel = Math.min(trackGoal, trackVel + step);
    else trackVel = Math.max(trackGoal, trackVel - step);

    trackX += trackVel * dt;
    if (trackX > area.maxX) {
        trackX = area.maxX;
        trackVel = -Math.abs(trackVel);
        trackGoal = -Math.abs(trackGoal);
    }
    if (trackX < area.minX) {
        trackX = area.minX;
        trackVel = Math.abs(trackVel);
        trackGoal = Math.abs(trackGoal);
    }

    const target = Entities.FindByName("target.track")[0];
    if (!target) return;
    const pos = { x: trackX, y: trackY, z: trackZ };
    target.Move({ position: pos });
    up.set("target.track", pos);
}

function reflexThink(now) {
    if (now < reflexAt) return;
    if (up.has("target.flick")) {
        hide("target.flick");
        streak = 0;
        reflexAt = now + rand(0.3, 0.9);
        status(now);
        return;
    }
    place("target.flick", pick());
    markAt = now;
    reflexAt = now + 0.8;
}

function onHit(name, now) {
    if (hitAt.get(name) === now) return;
    hitAt.set(name, now);
    hits++;
    streak++;
    missed = false;
    if (streak > bestStreak) bestStreak = streak;
    timeSum += now - markAt;
    markAt = now;
    if (now - bellAt >= 0.1) {
        bellAt = now;
        fire("snd.hit", "StartSound");
    }

    if (mode === "flick" || mode === "grid") place(name, pick(up.get(name)));
    if (mode === "micro") place(name, near(up.get(name)));
    if (mode === "reflex") {
        hide(name);
        reflexAt = now + rand(0.3, 0.9);
    }
    if (mode === "speed") {
        hide(name);
        if (up.size === 0) spawnSpeed();
    }
    if (moving.includes(mode)) {
        tint(name, hitColor);
        colorUntil = now + 0.06;
    }
    status(now);
}

Instance.SetThink(() => {
    const now = Instance.GetGameTime();
    const dt = Math.min(0.1, now - prev);
    prev = now;

    if (flashUntil && now >= flashUntil) {
        flashUntil = 0;
        hudShow("flash", false);
    }
    if (colorUntil && now >= colorUntil) {
        colorUntil = 0;
        tint("target.track", targetColor);
    }

    if (phase === "countdown") {
        const left = Math.ceil(startAt - now);
        if (left <= 0) begin(now);
        else if (left !== shownSec) {
            shownSec = left;
            board(mode + " starts in " + left);
            flash(left, 0.9);
        }
    }

    if (phase === "run") {
        if (now >= endAt) finish();
        else {
            if (moving.includes(mode)) moveTrack(now, dt);
            if (mode === "reflex") reflexThink(now);
            const left = Math.ceil(endAt - now);
            if (left !== shownSec) {
                shownSec = left;
                status(now);
            }
        }
    }

    if (phase !== "idle" || flashUntil) Instance.SetNextThink(now);
});

Instance.OnGunFire(() => {
    if (phase !== "run") return;
    if (missed) streak = 0;
    missed = true;
    shots++;
});

Instance.OnBulletImpact(({ hitEntity }) => {
    if (!hitEntity || !hitEntity.IsValid()) return;
    const name = hitEntity.GetEntityName();

    if (name === "btn.stop") {
        stop();
        return;
    }
    if (name.startsWith("btn.")) {
        start(name.slice(4));
        return;
    }
    if (phase === "run" && up.has(name)) onHit(name, Instance.GetGameTime());
});

Instance.OnRoundStart(reset);

Instance.OnActivate(() => {
    Console.SetConvar("sv_infinite_ammo", 2);
    records();
});

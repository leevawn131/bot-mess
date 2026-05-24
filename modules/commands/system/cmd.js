const fs = require("fs");
const path = require("path");

const COMMANDS_ROOT = path.join(__dirname, "..");
const EVENTS_ROOT = path.join(__dirname, "..", "..", "events");
const UTILS_ROOT = path.join(__dirname, "..", "..", "utils");

const MODULE_ROOTS = [
    { type: "command", dir: COMMANDS_ROOT },
    { type: "event", dir: EVENTS_ROOT },
    { type: "util", dir: UTILS_ROOT },
];

function normalizeKey(value) {
    return String(value || "").trim().toLowerCase();
}

function getAdminIds(config) {
    const direct = Array.isArray(config?.adminIDs) ? config.adminIDs : [];
    const fallback = Array.isArray(global.config?.adminIDs) ? global.config.adminIDs : [];
    return [...new Set([...direct, ...fallback].map((id) => String(id).trim()).filter(Boolean))];
}

function isBotAdmin(senderID, config) {
    return getAdminIds(config).includes(String(senderID));
}

function walkJsFiles(dir) {
    if (!fs.existsSync(dir)) return [];

    const result = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...walkJsFiles(fullPath));
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".js")) {
            result.push(fullPath);
        }
    }

    return result;
}

function getModuleExport(filePath, forceReload = true) {
    if (forceReload && require.cache[require.resolve(filePath)]) {
        delete require.cache[require.resolve(filePath)];
    }

    return require(filePath);
}

function listAllModuleFiles() {
    const list = [];

    for (const root of MODULE_ROOTS) {
        const files = walkJsFiles(root.dir);
        for (const filePath of files) {
            list.push({ ...root, filePath });
        }
    }

    return list;
}

function moduleDisplayName(moduleInfo) {
    return `${moduleInfo.type}:${path.basename(moduleInfo.filePath, ".js")}`;
}

function resolveModuleCandidates(target) {
    const key = normalizeKey(target);
    if (!key) return [];

    const files = listAllModuleFiles();
    const direct = files.filter((info) => normalizeKey(path.basename(info.filePath, ".js")) === key);
    if (direct.length > 0) return direct;

    const byName = [];
    const seen = new Set();

    for (const info of files) {
        try {
            const exported = getModuleExport(info.filePath, false);
            const exportedName = normalizeKey(exported?.name || exported?.config?.name || "");
            const aliases = []
                .concat(exported?.aliases || [])
                .concat(exported?.config?.aliases || [])
                .map(normalizeKey)
                .filter(Boolean);

            if (exportedName === key || aliases.includes(key)) {
                const id = `${info.type}:${info.filePath}`;
                if (!seen.has(id)) {
                    byName.push(info);
                    seen.add(id);
                }
            }
        } catch {}
    }

    return byName;
}

function ensureRegistries() {
    if (!global.commands || !(global.commands instanceof Map)) {
        global.commands = new Map();
    }

    if (!global.events || !(global.events instanceof Map)) {
        global.events = new Map();
    }

    if (!global.loadedUtils || !(global.loadedUtils instanceof Map)) {
        global.loadedUtils = new Map();
    }
}

function loadCommand(filePath) {
    ensureRegistries();

    const command = getModuleExport(filePath, true);
    const name = normalizeKey(command?.name || command?.config?.name || path.basename(filePath, ".js"));

    if (!command || (typeof command.execute !== "function" && typeof command.run !== "function")) {
        throw new Error("Module không đúng định dạng (thiếu execute/run).");
    }

    if (typeof command.execute !== "function" && typeof command.run === "function") {
        command.execute = command.run;
    }

    if (!command.name) command.name = command?.config?.name || name;
    command.__filePath = filePath;
    global.commands.set(command.name, command);
    return command;
}

function loadEvent(filePath) {
    ensureRegistries();

    const ev = getModuleExport(filePath, true);
    const evName = String(ev?.name || "").trim();

    if (!evName || typeof ev.execute !== "function") {
        throw new Error("Event không đúng định dạng (thiếu name/execute).");
    }

    ev.__filePath = filePath;
    global.events.set(evName, ev);
    return ev;
}

function loadUtil(filePath) {
    ensureRegistries();

    const utilExport = getModuleExport(filePath, true);
    const key = normalizeKey(path.basename(filePath, ".js"));

    global.loadedUtils.set(key, {
        filePath,
        loadedAt: Date.now(),
    });

    return utilExport;
}

function unloadCommandByFile(filePath) {
    ensureRegistries();
    let removedByName = false;

    for (const [name, command] of global.commands.entries()) {
        const cmdFile = command?.__filePath || command?.filePath;
        const sameByPath = cmdFile && path.resolve(cmdFile) === path.resolve(filePath);
        const sameByName = normalizeKey(name) === normalizeKey(path.basename(filePath, ".js"));
        if (sameByPath || sameByName) {
            global.commands.delete(name);
            removedByName = true;
        }
    }

    if (require.cache[require.resolve(filePath)]) {
        delete require.cache[require.resolve(filePath)];
    }

    return removedByName;
}

function unloadEventByFile(filePath) {
    ensureRegistries();
    let removed = false;

    for (const [name, ev] of global.events.entries()) {
        const evFile = ev?.__filePath || ev?.filePath;
        const sameByPath = evFile && path.resolve(evFile) === path.resolve(filePath);
        const sameByName = normalizeKey(name) === normalizeKey(path.basename(filePath, ".js"));
        if (sameByPath || sameByName) {
            global.events.delete(name);
            removed = true;
        }
    }

    if (require.cache[require.resolve(filePath)]) {
        delete require.cache[require.resolve(filePath)];
    }

    return removed;
}

function unloadUtilByFile(filePath) {
    ensureRegistries();
    const utilKey = normalizeKey(path.basename(filePath, ".js"));
    const removed = global.loadedUtils.delete(utilKey);

    if (require.cache[require.resolve(filePath)]) {
        delete require.cache[require.resolve(filePath)];
    }

    return removed;
}

function loadModuleByType(moduleInfo) {
    if (moduleInfo.type === "command") return loadCommand(moduleInfo.filePath);
    if (moduleInfo.type === "event") return loadEvent(moduleInfo.filePath);
    return loadUtil(moduleInfo.filePath);
}

function unloadModuleByType(moduleInfo) {
    if (moduleInfo.type === "command") return unloadCommandByFile(moduleInfo.filePath);
    if (moduleInfo.type === "event") return unloadEventByFile(moduleInfo.filePath);
    return unloadUtilByFile(moduleInfo.filePath);
}

function formatModuleInfo(moduleInfo, exported) {
    const displayName = exported?.name || exported?.config?.name || path.basename(moduleInfo.filePath, ".js");
    const description = exported?.description || exported?.config?.description || "Không có mô tả";
    const usage = exported?.usage || exported?.usages || exported?.config?.usage || exported?.config?.usages || "Không có";
    const aliases = []
        .concat(exported?.aliases || [])
        .concat(exported?.config?.aliases || [])
        .map(normalizeKey)
        .filter(Boolean);

    return [
        `📦 Module: ${displayName}`,
        `🏷 Loại: ${moduleInfo.type}`,
        `📝 Mô tả: ${description}`,
        `📌 Dùng: ${usage}`,
        `🔁 Alias: ${aliases.length ? aliases.join(", ") : "Không có"}`,
        `📁 File: ${path.relative(path.join(__dirname, "..", ".."), moduleInfo.filePath)}`,
    ].join("\n");
}

function getLoadedSummary() {
    ensureRegistries();
    return {
        commands: global.commands.size,
        events: global.events.size,
        utils: global.loadedUtils.size,
    };
}

function listLoadedDisplay() {
    ensureRegistries();

    const commands = Array.from(global.commands.keys()).sort((a, b) => a.localeCompare(b, "vi"));
    const events = Array.from(global.events.keys()).sort((a, b) => a.localeCompare(b, "vi"));
    const utils = Array.from(global.loadedUtils.keys()).sort((a, b) => a.localeCompare(b, "vi"));

    return [
        `📦 Commands (${commands.length}): ${commands.length ? commands.join(", ") : "không có"}`,
        `⚡ Events (${events.length}): ${events.length ? events.join(", ") : "không có"}`,
        `🧩 Utils đã nạp qua cmd (${utils.length}): ${utils.length ? utils.join(", ") : "không có"}`,
    ].join("\n");
}

function parseTargets(rawArgs) {
    const items = rawArgs
        .join(" ")
        .split(/[\s,]+/)
        .map(normalizeKey)
        .filter(Boolean);

    return [...new Set(items)];
}

module.exports = {
    name: "cmd",
    aliases: ["command"],
    description: "Quản lý module bot (commands/events/utils)",
    usage: "\n!cmd count\n!cmd list\n!cmd info <tên...>\n!cmd load <tên...>\n!cmd unload <tên...>\n!cmd reload <tên...>\n(ví dụ: !cmd load kiss likeDelete mentionResolver)",

    execute: async ({ api, event, args, config }) => {
        const { threadID, messageID, senderID } = event;

        if (!isBotAdmin(senderID, config)) {
            return api.sendMessage("❌ Chỉ admin bot mới dùng được lệnh này.", threadID, messageID);
        }

        ensureRegistries();

        const action = normalizeKey(args[0]);
        const targets = parseTargets(args.slice(1));

        if (!action || action === "help") {
            return api.sendMessage(
                [
                    "🛠 CMD - Quản lý lệnh",
                    "━━━━━━━━━━━━━━━━━━",
                    "!cmd count - xem số module đang nạp",
                    "!cmd list - xem danh sách command/event/util",
                    "!cmd info <tên...> - xem thông tin module",
                    "!cmd load <tên...> - nạp module từ 3 folder",
                    "!cmd unload <tên...> - gỡ module khỏi bộ nhớ",
                    "!cmd reload <tên...> - nạp lại module",
                    "Có thể nhập nhiều tên bằng dấu cách hoặc dấu phẩy",
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "count") {
            const summary = getLoadedSummary();
            return api.sendMessage(
                [
                    "📊 MODULE COUNT",
                    `📦 Commands: ${summary.commands}`,
                    `⚡ Events: ${summary.events}`,
                    `🧩 Utils (load qua cmd): ${summary.utils}`,
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "list") {
            return api.sendMessage(listLoadedDisplay(), threadID, messageID);
        }

        if (targets.length === 0 && ["info", "load", "unload", "reload"].includes(action)) {
            return api.sendMessage("⚠️ Vui lòng nhập tên lệnh.", threadID, messageID);
        }

        if (action === "info") {
            const outputs = [];
            let missing = 0;

            for (const target of targets) {
                const candidates = resolveModuleCandidates(target);
                if (candidates.length === 0) {
                    outputs.push(`❌ ${target}: Không tìm thấy lệnh.`);
                    missing += 1;
                    continue;
                }

                for (const moduleInfo of candidates) {
                    try {
                        const exported = getModuleExport(moduleInfo.filePath, false);
                        outputs.push(formatModuleInfo(moduleInfo, exported));
                    } catch (error) {
                        outputs.push(`❌ ${moduleDisplayName(moduleInfo)}: ${error.message || error}`);
                    }
                }
            }

            return api.sendMessage(
                [
                    `📘 Thông tin lệnh (${targets.length - missing}/${targets.length})`,
                    "━━━━━━━━━━━━━━━━━━",
                    outputs.join("\n\n━━━━━━━━━━━━━━━━━━\n"),
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "unload") {
            const success = [];
            const fail = [];

            for (const target of targets) {
                const candidates = resolveModuleCandidates(target);
                if (candidates.length === 0) {
                    fail.push(`${target} (không tìm thấy)`);
                    continue;
                }

                for (const moduleInfo of candidates) {
                    try {
                        const removed = unloadModuleByType(moduleInfo);
                        if (removed) success.push(moduleDisplayName(moduleInfo));
                        else fail.push(`${moduleDisplayName(moduleInfo)} (chưa nạp)`);
                    } catch (error) {
                        fail.push(`${moduleDisplayName(moduleInfo)} (${error.message || error})`);
                    }
                }
            }

            return api.sendMessage(
                [
                    `🧹 UNLOAD hoàn tất`,
                    `✅ Thành công (${success.length}): ${success.length ? success.join(", ") : "không có"}`,
                    `❌ Thất bại (${fail.length}): ${fail.length ? fail.join(", ") : "không có"}`,
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "load" || action === "reload") {
            const success = [];
            const fail = [];

            for (const target of targets) {
                const candidates = resolveModuleCandidates(target);
                if (candidates.length === 0) {
                    fail.push(`${target} (không thấy file)`);
                    continue;
                }

                for (const moduleInfo of candidates) {
                    try {
                        if (action === "reload") {
                            unloadModuleByType(moduleInfo);
                        }
                        loadModuleByType(moduleInfo);
                        success.push(moduleDisplayName(moduleInfo));
                    } catch (error) {
                        fail.push(`${moduleDisplayName(moduleInfo)} (${error.message || error})`);
                    }
                }
            }

            const response = [
                `🔄 ${action.toUpperCase()} hoàn tất`,
                `✅ Thành công (${success.length}): ${success.length ? success.join(", ") : "không có"}`,
                `❌ Thất bại (${fail.length}): ${fail.length ? fail.join(", ") : "không có"}`,
            ].join("\n");

            return api.sendMessage(
                response,
                threadID,
                messageID,
            );
        }

        return api.sendMessage(
            "⚠️ Subcommand không hợp lệ. Dùng !cmd help để xem hướng dẫn.",
            threadID,
            messageID,
        );
    },
};
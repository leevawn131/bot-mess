const fs = require("fs");
const path = require("path");

const COMMANDS_ROOT = path.join(__dirname, "..");
const EVENTS_ROOT = path.join(__dirname, "..", "..", "events");
const UTILS_ROOT = path.join(__dirname, "..", "..", "utils");
const prefix = process.env.BOT_PREFIX || "!";

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

function clearRequireCacheRecursive(filePath) {
    const resolvedPath = path.resolve(filePath);
    const mod = require.cache[resolvedPath];
    if (!mod) return;

    if (Array.isArray(mod.children)) {
        for (const child of mod.children) {
            if (child.id && (child.id.includes("/modules/") || child.id.includes("/includes/") || child.id.includes("/src/"))) {
                clearRequireCacheRecursive(child.id);
            }
        }
    }

    delete require.cache[resolvedPath];
}

function getModuleExport(filePath, forceReload = true) {
    if (forceReload) {
        clearRequireCacheRecursive(filePath);
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

    if (key === "all" || key === "*") {
        return files;
    }

    const byPath = files.filter((info) => {
        const relPath = normalizeKey(path.relative(path.join(__dirname, "..", ".."), info.filePath));
        const baseName = normalizeKey(path.basename(info.filePath, ".js"));
        const baseNameWithExt = normalizeKey(path.basename(info.filePath));
        return relPath === key || relPath.endsWith(key) || baseName === key || baseNameWithExt === key;
    });

    if (byPath.length > 0) return byPath;

    const byName = [];
    const seen = new Set();

    for (const info of files) {
        try {
            const exported = require(info.filePath);
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
        } catch (e) {}
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

    if (!global.client) global.client = {};
    if (!global.client.commands) global.client.commands = global.commands;
    if (!global.client.events) global.client.events = global.events;
}

function loadCommand(filePath) {
    ensureRegistries();

    clearRequireCacheRecursive(filePath);
    const command = require(filePath);

    if (!command) {
        throw new Error("Module không đúng định dạng (rỗng).");
    }

    const name = normalizeKey(command?.name || command?.config?.name || path.basename(filePath, ".js"));

    if (typeof command.execute !== "function" && typeof command.run !== "function") {
        throw new Error("Module không đúng định dạng (thiếu execute/run).");
    }

    if (typeof command.execute !== "function" && typeof command.run === "function") {
        command.execute = command.run;
    }
    if (typeof command.run !== "function" && typeof command.execute === "function") {
        command.run = command.execute;
    }

    if (!command.name) command.name = command?.config?.name || name;
    command.__filePath = filePath;

    // Tự động phân quyền dựa trên thư mục chứa file
    const parentDirName = path.basename(path.dirname(filePath));
    const currentPerm = command.hasPermission ?? command.hasPermssion ?? command.config?.hasPermission ?? command.config?.hasPermssion ?? 0;

    if (parentDirName === "qtv" && currentPerm < 1) {
        command.hasPermission = 1;
    } else if (parentDirName === "adminbot" && currentPerm < 2) {
        command.hasPermission = 2;
    } else if (!command.hasOwnProperty('hasPermission')) {
        command.hasPermission = currentPerm;
    }

    // Đăng ký vào Map chính và global.client
    global.commands.set(command.name, command);
    if (global.client && global.client.commands) {
        global.client.commands.set(command.name, command);
    }

    // Đăng ký tất cả Aliases
    const aliases = []
        .concat(command.aliases || [])
        .concat(command.config?.aliases || [])
        .map(normalizeKey)
        .filter(Boolean);

    for (const alias of aliases) {
        global.commands.set(alias, command);
        if (global.client && global.client.commands) {
            global.client.commands.set(alias, command);
        }
    }

    return command;
}

function loadEvent(filePath) {
    ensureRegistries();

    clearRequireCacheRecursive(filePath);
    const ev = require(filePath);
    const evName = String(ev?.name || ev?.config?.name || path.basename(filePath, ".js")).trim();

    if (!ev || (typeof ev.execute !== "function" && typeof ev.run !== "function")) {
        throw new Error("Event không đúng định dạng (thiếu name/execute/run).");
    }

    if (typeof ev.execute !== "function" && typeof ev.run === "function") {
        ev.execute = ev.run;
    }

    if (!ev.name) ev.name = evName;
    ev.__filePath = filePath;

    global.events.set(ev.name, ev);
    if (global.client && global.client.events) {
        global.client.events.set(ev.name, ev);
    }

    return ev;
}

function loadUtil(filePath) {
    ensureRegistries();
    clearRequireCacheRecursive(filePath);

    const utilExport = require(filePath);
    const key = normalizeKey(path.basename(filePath, ".js"));

    global.loadedUtils.set(key, {
        filePath,
        loadedAt: Date.now(),
    });

    return utilExport;
}

function unloadCommandByFile(filePath) {
    ensureRegistries();
    let removedCount = 0;
    const resolvedTarget = path.resolve(filePath);

    const keysToRemove = [];
    for (const [key, command] of global.commands.entries()) {
        const cmdFile = command?.__filePath || command?.filePath;
        if (cmdFile && path.resolve(cmdFile) === resolvedTarget) {
            keysToRemove.push(key);
        }
    }

    for (const key of keysToRemove) {
        global.commands.delete(key);
        if (global.client && global.client.commands) {
            global.client.commands.delete(key);
        }
        removedCount++;
    }

    clearRequireCacheRecursive(resolvedTarget);
    return removedCount > 0;
}

function unloadEventByFile(filePath) {
    ensureRegistries();
    let removedCount = 0;
    const resolvedTarget = path.resolve(filePath);

    const keysToRemove = [];
    for (const [key, ev] of global.events.entries()) {
        const evFile = ev?.__filePath || ev?.filePath;
        if (evFile && path.resolve(evFile) === resolvedTarget) {
            keysToRemove.push(key);
        }
    }

    for (const key of keysToRemove) {
        global.events.delete(key);
        if (global.client && global.client.events) {
            global.client.events.delete(key);
        }
        removedCount++;
    }

    clearRequireCacheRecursive(resolvedTarget);
    return removedCount > 0;
}

function unloadUtilByFile(filePath) {
    ensureRegistries();
    const utilKey = normalizeKey(path.basename(filePath, ".js"));
    const removed = global.loadedUtils.delete(utilKey);

    clearRequireCacheRecursive(filePath);
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

    const commands = Array.from(new Set(global.commands.values()))
        .map((c) => c?.name || c?.config?.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "vi"));

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
    description: "Quản lý module bot (commands/events/utils) - Nạp & reload tức thì",
    usage: `\n${prefix}cmd count\n${prefix}cmd list\n${prefix}cmd info <tên...>\n${prefix}cmd load <tên... | all>\n${prefix}cmd unload <tên... | all>\n${prefix}cmd reload <tên... | all>\n(Ví dụ: ${prefix}cmd reload kiss checktt warningStorage / ${prefix}cmd reload all)`,

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
                    "🛠 CMD - Quản lý lệnh & module",
                    "━━━━━━━━━━━━━",
                    `${prefix}cmd count - Xem số lượng module đang nạp`,
                    `${prefix}cmd list - Xem danh sách command/event/util`,
                    `${prefix}cmd info <tên...> - Xem thông tin chi tiết module`,
                    `${prefix}cmd load <tên... | all> - Nạp module từ ổ đĩa`,
                    `${prefix}cmd unload <tên... | all> - Gỡ module khỏi bộ nhớ`,
                    `${prefix}cmd reload <tên... | all> - Nạp lại module tức thì`,
                    "💡 Có thể nhập nhiều tên bằng dấu cách, dấu phẩy hoặc gõ 'all' để reload toàn bộ",
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "count") {
            const summary = getLoadedSummary();
            return api.sendMessage(
                [
                    "📊 THỐNG KÊ MODULE",
                    `📦 Commands: ${summary.commands}`,
                    `⚡ Events: ${summary.events}`,
                    `🧩 Utils: ${summary.utils}`,
                ].join("\n"),
                threadID,
                messageID,
            );
        }

        if (action === "list") {
            return api.sendMessage(listLoadedDisplay(), threadID, messageID);
        }

        if (targets.length === 0 && ["info", "load", "unload", "reload"].includes(action)) {
            return api.sendMessage(`⚠️ Vui lòng nhập tên lệnh hoặc gõ '${prefix}cmd reload all' để nạp lại tất cả.`, threadID, messageID);
        }

        if (action === "info") {
            const outputs = [];
            let missing = 0;

            for (const target of targets) {
                const candidates = resolveModuleCandidates(target);
                if (candidates.length === 0) {
                    outputs.push(`❌ ${target}: Không tìm thấy module.`);
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
                    "━━━━━━━━━━━━━",
                    outputs.join("\n\n━━━━━━━━━━━━━\n"),
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
            `⚠️ Subcommand không hợp lệ. Dùng ${prefix}cmd help để xem hướng dẫn.`,
            threadID,
            messageID,
        );
    },
};
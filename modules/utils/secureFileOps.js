const fs = require('fs').promises;
const path = require('path');
const fsSync = require('fs');

/**
 * Set secure file permissions
 */
async function setSecurePermissions(filePath, mode = 0o600) {
    try {
        await fs.chmod(filePath, mode);
        return true;
    } catch (error) {
        console.error(`Failed to set permissions for ${filePath}:`, error);
        return false;
    }
}

/**
 * Ensure directory exists with secure permissions
 */
async function ensureDirectory(dirPath, mode = 0o700) {
    try {
        await fs.mkdir(dirPath, { recursive: true, mode });
        await fs.chmod(dirPath, mode);
        return true;
    } catch (error) {
        console.error(`Failed to create directory ${dirPath}:`, error);
        return false;
    }
}

/**
 * Read JSON file securely
 */
async function readJsonFile(filePath, fallback = null) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        console.error(`Failed to read JSON file ${filePath}:`, error);
        return fallback;
    }
}

/**
 * Write JSON file securely
 */
async function writeJsonFile(filePath, data, mode = 0o600) {
    try {
        const dirPath = path.dirname(filePath);
        await ensureDirectory(dirPath);

        const content = JSON.stringify(data, null, 2);
        await fs.writeFile(filePath, content, { mode });

        return true;
    } catch (error) {
        console.error(`Failed to write JSON file ${filePath}:`, error);
        return false;
    }
}

/**
 * Append to file securely
 */
async function appendToFile(filePath, content, mode = 0o600) {
    try {
        const dirPath = path.dirname(filePath);
        await ensureDirectory(dirPath);

        await fs.appendFile(filePath, content, { mode });
        return true;
    } catch (error) {
        console.error(`Failed to append to file ${filePath}:`, error);
        return false;
    }
}

/**
 * Read file securely
 */
async function readFile(filePath, encoding = 'utf8') {
    try {
        return await fs.readFile(filePath, encoding);
    } catch (error) {
        console.error(`Failed to read file ${filePath}:`, error);
        return null;
    }
}

/**
 * Write file securely
 */
async function writeFile(filePath, content, mode = 0o600) {
    try {
        const dirPath = path.dirname(filePath);
        await ensureDirectory(dirPath);

        await fs.writeFile(filePath, content, { mode });
        return true;
    } catch (error) {
        console.error(`Failed to write file ${filePath}:`, error);
        return false;
    }
}

/**
 * Delete file securely
 */
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return true; // File doesn't exist, consider as success
        }
        console.error(`Failed to delete file ${filePath}:`, error);
        return false;
    }
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Get file stats
 */
async function getFileStats(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return {
            size: stats.size,
            modified: stats.mtime,
            created: stats.birthtime,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory()
        };
    } catch (error) {
        console.error(`Failed to get stats for ${filePath}:`, error);
        return null;
    }
}

/**
 * List files in directory
 */
async function listFiles(dirPath, options = {}) {
    try {
        const files = await fs.readdir(dirPath, options);
        return files;
    } catch (error) {
        console.error(`Failed to list files in ${dirPath}:`, error);
        return [];
    }
}

/**
 * Create temporary file with secure permissions
 */
async function createTempFile(prefix = 'temp', suffix = '.tmp', mode = 0o600) {
    const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), prefix));
    const tempPath = path.join(tempDir, `${prefix}${Date.now()}${suffix}`);

    await fs.writeFile(tempPath, '', { mode });

    return {
        path: tempPath,
        cleanup: async () => {
            try {
                await fs.unlink(tempPath);
                await fs.rmdir(tempDir);
            } catch (error) {
                console.error(`Failed to cleanup temp file ${tempPath}:`, error);
            }
        }
    };
}

/**
 * Atomic file write (write to temp file then rename)
 */
async function atomicWriteFile(filePath, content, mode = 0o600) {
    const tempFile = await createTempFile('atomic', '.tmp');

    try {
        await fs.writeFile(tempFile.path, content, { mode });
        await fs.rename(tempFile.path, filePath);
        await tempFile.cleanup();
        return true;
    } catch (error) {
        await tempFile.cleanup();
        console.error(`Failed to atomically write ${filePath}:`, error);
        return false;
    }
}

/**
 * Validate file path (prevent directory traversal)
 */
function validateFilePath(filePath, allowedBaseDir = null) {
    const normalizedPath = path.normalize(filePath);

    // Check for directory traversal
    if (normalizedPath.includes('..')) {
        throw new Error('Invalid file path: directory traversal detected');
    }

    // Check if path is within allowed directory
    if (allowedBaseDir) {
        const resolvedPath = path.resolve(normalizedPath);
        const resolvedBase = path.resolve(allowedBaseDir);

        if (!resolvedPath.startsWith(resolvedBase)) {
            throw new Error('Invalid file path: outside allowed directory');
        }
    }

    return normalizedPath;
}

/**
 * Secure file operations wrapper
 */
const secureFileOps = {
    readJson: readJsonFile,
    writeJson: writeJsonFile,
    read: readFile,
    write: writeFile,
    append: appendToFile,
    delete: deleteFile,
    exists: fileExists,
    stats: getFileStats,
    list: listFiles,
    atomicWrite: atomicWriteFile,
    validatePath: validateFilePath,
    setPermissions: setSecurePermissions,
    ensureDir: ensureDirectory
};

module.exports = {
    setSecurePermissions,
    ensureDirectory,
    readJsonFile,
    writeJsonFile,
    appendToFile,
    readFile,
    writeFile,
    deleteFile,
    fileExists,
    getFileStats,
    listFiles,
    createTempFile,
    atomicWriteFile,
    validateFilePath,
    secureFileOps
};
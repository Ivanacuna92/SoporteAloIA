const fs = require('fs').promises;
const path = require('path');

const DOCS_ROOT = process.env.DOCS_MIRROR_PATH || path.join(__dirname, '../../docs_mirror');

// Archivos prioritarios para contexto de soporte (orden importa)
const PRIORITY_FILES = [
    'README.md',
    'ARCHITECTURE.md',
    'OPERATIONS.md',
    'TROUBLESHOOTING.md',
    'API.md',
    'USERS.md',
    'DATABASE.md',
    'DEPLOYMENT.md',
    'SECURITY.md',
    'TESTING.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
];

// Carpetas que NO son proyectos
const EXCLUDE_DIRS = new Set([
    'assets', 'audit-history', '_media', '_images',
]);

function looksLikeBackup(name) {
    return /\.bak(-|$)/.test(name) || /\.old(-|$)/.test(name) || name.startsWith('.');
}

async function listProjects() {
    let entries;
    try {
        entries = await fs.readdir(DOCS_ROOT, { withFileTypes: true });
    } catch (e) {
        console.warn('[docs] no se pudo leer DOCS_ROOT:', e.message);
        return [];
    }
    const projects = [];
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (EXCLUDE_DIRS.has(e.name)) continue;
        if (looksLikeBackup(e.name)) continue;
        // Debe tener README.md
        try {
            await fs.access(path.join(DOCS_ROOT, e.name, 'README.md'));
            projects.push({ slug: e.name, name: e.name });
        } catch {}
    }
    projects.sort((a, b) => a.slug.localeCompare(b.slug));
    return projects;
}

async function projectExists(slug) {
    if (!slug) return false;
    if (looksLikeBackup(slug)) return false;
    try {
        await fs.access(path.join(DOCS_ROOT, slug, 'README.md'));
        return true;
    } catch { return false; }
}

/**
 * Lee los .md prioritarios de un proyecto, concatena con encabezados.
 * Cap global ~30KB. Cap por archivo ~6KB.
 */
async function getProjectContext(slug, { maxTotalChars = 30000, maxPerFile = 6000 } = {}) {
    if (!(await projectExists(slug))) return null;
    const dir = path.join(DOCS_ROOT, slug);
    const chunks = [];
    let total = 0;
    for (const fname of PRIORITY_FILES) {
        if (total >= maxTotalChars) break;
        try {
            let content = await fs.readFile(path.join(dir, fname), 'utf8');
            content = content.trim();
            if (!content) continue;
            if (content.length > maxPerFile) {
                content = content.substring(0, maxPerFile) + '\n…[truncado]';
            }
            const header = `\n\n===== ${fname} =====\n`;
            if (total + header.length + content.length > maxTotalChars) {
                const remain = maxTotalChars - total - header.length - 20;
                if (remain < 200) break;
                content = content.substring(0, remain) + '\n…[truncado]';
            }
            chunks.push(header + content);
            total += header.length + content.length;
        } catch {}
    }
    if (!chunks.length) return null;
    return chunks.join('');
}

module.exports = {
    listProjects,
    projectExists,
    getProjectContext,
    DOCS_ROOT,
};

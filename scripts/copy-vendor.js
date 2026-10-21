const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = {
    'marked.js': 'node_modules/marked/lib/marked.umd.js',
    'purify.js': 'node_modules/dompurify/dist/purify.min.js',
};

const outDir = path.join(ROOT, 'public', 'vendor');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, source] of Object.entries(FILES)) {
    fs.copyFileSync(path.join(ROOT, source), path.join(outDir, name));
}

const fs = require('fs');
const path = require('path');

// 🔥 YOUR ACTUAL PATH
const INPUT_DIR = '/Users/tarunshetty/Desktop/teamsync-cluely-ai-assistant/dist-electron/premium/electron/knowledge';

// Output folder (your project)
const OUTPUT_DIR = '/Users/tarunshetty/Desktop/teamsync-cluely-ai-assistant/premium/electron/knowledge';

// Create output folder if not exists
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const mapFiles = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.js.map'));

console.log(`📦 Found ${mapFiles.length} .map files\n`);

mapFiles.forEach(file => {
    const mapPath = path.join(INPUT_DIR, file);

    try {
        const raw = fs.readFileSync(mapPath, 'utf-8');
        const map = JSON.parse(raw);

        const sources = map.sources || [];
        const contents = map.sourcesContent || [];

        if (!sources.length || !contents.length) {
            console.log(`⚠️ Skipped ${file} (no sourcesContent)`);
            return;
        }

        sources.forEach((src, index) => {
            const code = contents[index];
            if (!code) return;

            const filename = path.basename(src);
            const outputPath = path.join(OUTPUT_DIR, filename);

            fs.writeFileSync(outputPath, code, 'utf-8');
            console.log(`✅ Created: ${filename}`);
        });

    } catch (err) {
        console.log(`❌ Error processing ${file}`);
    }
});

console.log('\n🎉 DONE: All TypeScript files restored successfully!');
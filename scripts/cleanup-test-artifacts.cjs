const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DB_FILES = ['migallery.db', 'migallery.db-shm', 'migallery.db-wal'];

console.log('🧹 Cleaning up test artifacts...');

DB_FILES.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`Deleted ${file}`);
        } catch (e) {
            console.warn(`Failed to delete ${file}: ${e.message}`);
        }
    }
});

console.log('✨ Cleanup complete.');

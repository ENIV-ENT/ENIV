const fs = require('fs');
const path = require('path');
const db = require('../models/dbHelper');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
/** 5 GB. */
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;
/** Minimum age (one month) before a file can be deleted to free space. */
const MIN_FILE_AGE_DAYS = 30;

/** Total size of the files directly in a directory. */
function calcDirSize(dirPath) {
  let totalSize = 0;

  if (!fs.existsSync(dirPath)) {
    return totalSize;
  }

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isFile()) {
      totalSize += stats.size;
    }
  }

  return totalSize;
}

/** Formats a size in MB/GB, in French units (Mo/Go). */
function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

/** Deletes a file and its converted PDF; returns the number of bytes freed. */
function deleteFileAndConverted(filePath) {
  let totalDeleted = 0;

  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      fs.unlinkSync(filePath);
      totalDeleted += stats.size;
    }

    const ext = path.extname(filePath);
    if (ext !== '.pdf') {
      const pdfPath = filePath.replace(ext, '.pdf');
      if (fs.existsSync(pdfPath)) {
        const pdfStats = fs.statSync(pdfPath);
        fs.unlinkSync(pdfPath);
        totalDeleted += pdfStats.size;
      }
    }
  } catch (error) {
    console.error(`Failed to delete ${path.basename(filePath)}:`, error.message);
  }

  return totalDeleted;
}

/**
 * Checks the storage before an upload and frees space if needed, by deleting the
 * files of the oldest assignments first. Files are only deleted when the oldest
 * assignment is at least MIN_FILE_AGE_DAYS old. The errors are in French: they are
 * shown to the user.
 * @param {number} fileSize
 * @returns {Promise<{allowed: boolean, error?: string, cleaned?: {count: number, size: number}}>}
 */
async function checkBeforeUpload(fileSize) {
  try {
    const currentSize = calcDirSize(UPLOAD_DIR);
    const afterUploadSize = currentSize + fileSize;

    console.log(`📊 Current size: ${formatSize(currentSize)} / ${formatSize(MAX_UPLOAD_SIZE)}`);

    if (afterUploadSize <= MAX_UPLOAD_SIZE) {
      console.log(`✅ Enough space to upload ${formatSize(fileSize)}`);
      return { allowed: true };
    }

    const spaceNeeded = afterUploadSize - MAX_UPLOAD_SIZE;
    console.warn(`⚠️  ${formatSize(spaceNeeded)} must be freed...`);

    const files = await db.all(
      `SELECT df.id, df.filename, df.uploaded_at, d.date, d.titre
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       ORDER BY d.date ASC, df.uploaded_at ASC`
    );

    if (files.length === 0) {
      return {
        allowed: false,
        error: 'Espace insuffisant et aucun fichier à supprimer'
      };
    }

    const oldestFile = files[0];
    const oldestDate = new Date(oldestFile.date);
    const now = new Date();
    const daysDiff = Math.floor((now - oldestDate) / (1000 * 60 * 60 * 24));

    if (daysDiff < MIN_FILE_AGE_DAYS) {
      console.error(`❌ The oldest file is ${daysDiff} days old (minimum: ${MIN_FILE_AGE_DAYS})`);
      return {
        allowed: false,
        error: `Espace insuffisant. Le fichier le plus ancien a seulement ${daysDiff} jours (minimum ${MIN_FILE_AGE_DAYS} jours pour suppression). Veuillez contacter l'administrateur.`
      };
    }

    let freedSpace = 0;
    let deletedCount = 0;

    for (const file of files) {
      if (freedSpace >= spaceNeeded) break;

      const filePath = path.join(UPLOAD_DIR, file.filename);

      if (fs.existsSync(filePath)) {
        const deletedSize = deleteFileAndConverted(filePath);

        if (deletedSize > 0) {
          freedSpace += deletedSize;
          deletedCount++;

          await db.run('DELETE FROM devoir_fichiers WHERE id = ?', [file.id]);

          console.log(`  ✓ Deleted: ${file.titre} - ${file.filename} (${formatSize(deletedSize)})`);
        }
      }
    }

    console.log(`✅ ${deletedCount} files deleted, ${formatSize(freedSpace)} freed`);

    return { allowed: true, cleaned: { count: deletedCount, size: freedSpace } };
  } catch (error) {
    console.error('❌ Storage check failed:', error.message);
    return {
      allowed: false,
      error: 'Erreur lors de la vérification du stockage'
    };
  }
}

/** Storage statistics of the upload directory. */
async function getStorageStats() {
  try {
    const totalSize = calcDirSize(UPLOAD_DIR);
    const limit = MAX_UPLOAD_SIZE;
    const percentage = ((totalSize / limit) * 100).toFixed(1);

    return {
      current: formatSize(totalSize),
      currentBytes: totalSize,
      limit: formatSize(limit),
      limitBytes: limit,
      percentage: percentage,
      remaining: formatSize(limit - totalSize),
      remainingBytes: limit - totalSize
    };
  } catch (error) {
    console.error('❌ Storage stats failed:', error.message);
    throw error;
  }
}

module.exports = {
  checkBeforeUpload,
  getStorageStats,
  calcDirSize,
  formatSize
};

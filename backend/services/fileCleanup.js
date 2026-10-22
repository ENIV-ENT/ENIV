const fs = require('fs');
const path = require('path');
const db = require('../models/dbHelper');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024; // 5 Go en octets
const MIN_FILE_AGE_DAYS = 30; // Age minimum pour supprimer (1 mois)

/**
 * Calcule la taille totale du dossier uploads
 */
function calc_dir_size(dirPath) {
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

/**
 * Formate la taille en Mo/Go
 */
function format_size(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

/**
 * Supprime un fichier physique et son PDF converti
 */
function del_file_and_converted(filePath) {
  let totalDeleted = 0;
  
  try {
    // Supprimer le fichier original
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      fs.unlinkSync(filePath);
      totalDeleted += stats.size;
    }
    
    // Supprimer le PDF converti si existe
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
    console.error(`Erreur suppression ${path.basename(filePath)}:`, error.message);
  }
  
  return totalDeleted;
}

/**
 * Vérifie avant chaque upload et nettoie si nécessaire
 */
async function check_before_upload(fileSize) {
  try {
    const currentSize = calc_dir_size(UPLOAD_DIR);
    const afterUploadSize = currentSize + fileSize;
    
    console.log(`📊 Taille actuelle: ${format_size(currentSize)} / ${format_size(MAX_UPLOAD_SIZE)}`);
    
    if (afterUploadSize <= MAX_UPLOAD_SIZE) {
      console.log(`✅ Espace suffisant pour upload de ${format_size(fileSize)}`);
      return { allowed: true };
    }
    
    // Calculer l'espace nécessaire à libérer
    const spaceNeeded = afterUploadSize - MAX_UPLOAD_SIZE;
    console.warn(`⚠️  Besoin de libérer ${format_size(spaceNeeded)}...`);
    
    // Récupérer tous les fichiers triés par ancienneté
    const fichiers = await db.all(
      `SELECT df.id, df.filename, df.uploaded_at, d.date, d.titre
       FROM devoir_fichiers df
       JOIN devoirs d ON df.devoir_id = d.id
       ORDER BY d.date ASC, df.uploaded_at ASC`
    );
    
    if (fichiers.length === 0) {
      return { 
        allowed: false, 
        error: 'Espace insuffisant et aucun fichier à supprimer' 
      };
    }
    
    // Vérifier si le plus vieux fichier a moins d'1 mois
    const oldestFichier = fichiers[0];
    const oldestDate = new Date(oldestFichier.date);
    const now = new Date();
    const daysDiff = Math.floor((now - oldestDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < MIN_FILE_AGE_DAYS) {
      console.error(`❌ Le plus vieux fichier a ${daysDiff} jours (minimum: ${MIN_FILE_AGE_DAYS})`);
      return { 
        allowed: false, 
        error: `Espace insuffisant. Le fichier le plus ancien a seulement ${daysDiff} jours (minimum ${MIN_FILE_AGE_DAYS} jours pour suppression). Veuillez contacter l'administrateur.` 
      };
    }
    
    // Supprimer les fichiers jusqu'à avoir assez d'espace
    let freedSpace = 0;
    let deletedCount = 0;
    
    for (const fichier of fichiers) {
      if (freedSpace >= spaceNeeded) break;
      
      const filePath = path.join(UPLOAD_DIR, fichier.filename);
      
      if (fs.existsSync(filePath)) {
        const deletedSize = del_file_and_converted(filePath);
        
        if (deletedSize > 0) {
          freedSpace += deletedSize;
          deletedCount++;
          
          // Supprimer de la DB
          await db.run('DELETE FROM devoir_fichiers WHERE id = ?', [fichier.id]);
          
          console.log(`  ✓ Supprimé: ${fichier.titre} - ${fichier.filename} (${format_size(deletedSize)})`);
        }
      }
    }
    
    console.log(`✅ ${deletedCount} fichiers supprimés, ${format_size(freedSpace)} libérés`);
    
    return { allowed: true, cleaned: { count: deletedCount, size: freedSpace } };
  } catch (error) {
    console.error('❌ Erreur vérification stockage:', error.message);
    return { 
      allowed: false, 
      error: 'Erreur lors de la vérification du stockage' 
    };
  }
}

/**
 * Obtient les statistiques du stockage
 */
async function get_storage_stats() {
  try {
    const totalSize = calc_dir_size(UPLOAD_DIR);
    const limit = MAX_UPLOAD_SIZE;
    const percentage = ((totalSize / limit) * 100).toFixed(1);
    
    return {
      current: format_size(totalSize),
      currentBytes: totalSize,
      limit: format_size(limit),
      limitBytes: limit,
      percentage: percentage,
      remaining: format_size(limit - totalSize),
      remainingBytes: limit - totalSize
    };
  } catch (error) {
    console.error('❌ Erreur stats stockage:', error.message);
    throw error;
  }
}

module.exports = {
  check_before_upload,
  get_storage_stats,
  calc_dir_size,
  format_size
};

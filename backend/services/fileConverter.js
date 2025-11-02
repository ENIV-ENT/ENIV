const libre = require('libreoffice-convert');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');

const libreConvert = promisify(libre.convert);

/**
 * Vérifie si LibreOffice est installé sur le système
 */
async function isLibreOfficeInstalled() {
  return new Promise((resolve) => {
    exec('which libreoffice', (error) => {
      resolve(!error);
    });
  });
}

/**
 * Vérifie si un fichier nécessite une conversion
 */
function needsConversion(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext);
}

/**
 * Convertit un fichier DOCX/PPTX en PDF
 * @param {string} inputPath - Chemin du fichier source
 * @returns {Promise<string>} - Chemin du fichier PDF généré
 */
async function convertToPDF(inputPath) {
  try {
    const ext = path.extname(inputPath).toLowerCase();
    
    // Vérifier si la conversion est nécessaire
    if (!needsConversion(path.basename(inputPath))) {
      console.log(`✓ Fichier "${path.basename(inputPath)}" déjà en PDF, pas de conversion nécessaire`);
      return inputPath;
    }

    // Vérifier si LibreOffice est installé
    const libreInstalled = await isLibreOfficeInstalled();
    if (!libreInstalled) {
      throw new Error('LibreOffice n\'est pas installé sur ce serveur. Seuls les fichiers PDF sont supportés pour le moment.');
    }

    console.log(`🔄 Conversion de "${path.basename(inputPath)}" en PDF...`);

    // Vérifier si le PDF existe déjà
    const baseName = path.basename(inputPath, ext);
    const outputPath = path.join(path.dirname(inputPath), `${baseName}.pdf`);
    
    if (fs.existsSync(outputPath)) {
      console.log(`✓ PDF déjà converti : "${path.basename(outputPath)}"`);
      return outputPath;
    }

    // Lire le fichier source
    const docxBuffer = fs.readFileSync(inputPath);

    // Convertir en PDF
    const pdfBuffer = await libreConvert(docxBuffer, '.pdf', undefined);

    // Sauvegarder le PDF
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`✅ Conversion réussie : "${path.basename(outputPath)}"`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Erreur lors de la conversion de "${path.basename(inputPath)}":`, error.message);
    throw new Error(`Impossible de convertir le fichier en PDF: ${error.message}`);
  }
}

/**
 * Convertit plusieurs fichiers en PDF si nécessaire
 * @param {Array<string>} filePaths - Tableau des chemins de fichiers
 * @returns {Promise<Array<string>>} - Tableau des chemins des fichiers PDF
 */
async function convertMultipleToPDF(filePaths) {
  const convertedPaths = [];

  for (const filePath of filePaths) {
    try {
      const pdfPath = await convertToPDF(filePath);
      convertedPaths.push(pdfPath);
    } catch (error) {
      console.error(`⚠️ Impossible de convertir "${path.basename(filePath)}", ignoré`);
      // On continue avec les autres fichiers
    }
  }

  return convertedPaths;
}

module.exports = {
  convertToPDF,
  convertMultipleToPDF,
  needsConversion,
  isLibreOfficeInstalled
};

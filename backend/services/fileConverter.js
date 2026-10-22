const libre = require('libreoffice-convert');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { exec } = require('child_process');

const libreConvert = promisify(libre.convert);

/** Checks whether LibreOffice is installed on the system. */
async function isLibreOfficeInstalled() {
  return new Promise((resolve) => {
    exec('which libreoffice', (error) => {
      resolve(!error);
    });
  });
}

/** Whether a file needs a conversion to PDF (Word, PowerPoint, Excel). */
function needsConversion(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls'].includes(ext);
}

/**
 * Converts an office file to PDF with LibreOffice, next to the source file.
 * A PDF already converted is reused. The thrown messages are in French: the MCP
 * server shows them to the user.
 * @param {string} inputPath
 * @returns {Promise<string>} path of the PDF file
 */
async function convertToPdf(inputPath) {
  try {
    const ext = path.extname(inputPath).toLowerCase();

    if (!needsConversion(path.basename(inputPath))) {
      console.log(`✓ "${path.basename(inputPath)}" is already a PDF, no conversion needed`);
      return inputPath;
    }

    const libreInstalled = await isLibreOfficeInstalled();
    if (!libreInstalled) {
      throw new Error('LibreOffice n\'est pas installé sur ce serveur. Seuls les fichiers PDF sont supportés pour le moment.');
    }

    console.log(`🔄 Converting "${path.basename(inputPath)}" to PDF...`);

    const baseName = path.basename(inputPath, ext);
    const outputPath = path.join(path.dirname(inputPath), `${baseName}.pdf`);

    if (fs.existsSync(outputPath)) {
      console.log(`✓ PDF already converted: "${path.basename(outputPath)}"`);
      return outputPath;
    }

    const sourceBuffer = fs.readFileSync(inputPath);
    const pdfBuffer = await libreConvert(sourceBuffer, '.pdf', undefined);
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`✅ Conversion done: "${path.basename(outputPath)}"`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Conversion of "${path.basename(inputPath)}" failed:`, error.message);
    throw new Error(`Impossible de convertir le fichier en PDF: ${error.message}`, { cause: error });
  }
}

/**
 * Converts several files to PDF when needed. A file that fails is skipped.
 * @param {Array<string>} filePaths
 * @returns {Promise<Array<string>>} paths of the PDF files
 */
async function convertMultipleToPdf(filePaths) {
  const convertedPaths = [];

  for (const filePath of filePaths) {
    try {
      const pdfPath = await convertToPdf(filePath);
      convertedPaths.push(pdfPath);
    } catch {
      console.error(`⚠️ Cannot convert "${path.basename(filePath)}", skipped`);
    }
  }

  return convertedPaths;
}

module.exports = {
  convertToPdf,
  convertMultipleToPdf,
  needsConversion,
  isLibreOfficeInstalled
};

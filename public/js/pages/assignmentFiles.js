/**
 * Files page of an assignment (/devoir-pdf/?id=…): lists its documents and
 * uploads new ones. Everyone in the class can add and delete any file.
 * @module assignmentFiles
 */

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
];
const MAX_FILE_SIZE = 50 * 1024 * 1024;

let assignmentId = null;
let currentFile = null;

function authHeaders() {
  return { 'Authorization': `Bearer ${localStorage.getItem('token')}` };
}

function getAssignmentIdFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('id');
}

function showAlert(type, message) {
  const alert = document.getElementById('alert');
  alert.className = `alert ${type}`;
  alert.textContent = message;
  alert.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      alert.style.display = 'none';
    }, 3000);
  }
}

async function loadAssignmentInfo() {
  try {
    assignmentId = getAssignmentIdFromUrl();
    if (!assignmentId) {
      showAlert('error', 'Aucun devoir spécifié');
      setTimeout(() => window.location.href = '/dashboard', 2000);
      return;
    }

    const response = await fetch(`/api/devoirs/${assignmentId}`, { headers: authHeaders() });

    if (!response.ok) {
      throw new Error('Assignment loading failed');
    }

    const assignment = await response.json();
    document.getElementById('assignment-title').textContent = assignment.titre;

    const userResponse = await fetch('/api/auth/me', { headers: authHeaders() });

    if (userResponse.ok) {
      document.getElementById('upload-section').style.display = 'block';
    }

    loadFiles();
  } catch (error) {
    console.error('Assignment error:', error);
    showAlert('error', 'Impossible de charger le devoir');
    setTimeout(() => window.location.href = '/dashboard', 2000);
  }
}

async function loadFiles() {
  try {
    const response = await fetch(`/api/devoirs/${assignmentId}/fichiers`, { headers: authHeaders() });

    if (!response.ok) {
      throw new Error('Files loading failed');
    }

    const files = await response.json();
    displayFiles(files);
  } catch (error) {
    console.error('Files error:', error);
    showAlert('error', 'Impossible de charger les fichiers');
  }
}

function fileIcon(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['docx', 'doc'].includes(ext)) return '📘';
  if (['pptx', 'ppt'].includes(ext)) return '📙';
  if (['xlsx', 'xls'].includes(ext)) return '📗';
  return '📄';
}

function displayFiles(files) {
  const filesList = document.getElementById('files-list');

  if (files.length === 0) {
    filesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>Aucun document PDF pour le moment</p>
      </div>
    `;
    return;
  }

  filesList.innerHTML = files.map(file => {
    const date = new Date(file.uploaded_at);
    const uploadedBy = file.uploaded_by_username
      ? `par ${file.uploaded_by_username}`
      : '';

    return `
      <div class="file-item">
        <div class="file-info">
          <div class="file-icon">${fileIcon(file.original_name)}</div>
          <div class="file-details">
            <div class="file-name">${file.original_name}</div>
            <div class="file-meta">Ajouté le ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR')} ${uploadedBy}</div>
          </div>
        </div>
        <div class="file-actions">
          <a href="/api/devoirs/fichiers/${file.id}/pdf" target="_blank" class="btn btn-primary">Ouvrir</a>
          <button class="btn btn-danger delete-file-btn" data-id="${file.id}">Supprimer</button>
        </div>
      </div>
    `;
  }).join('');
}

function handleFileSelect(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    showAlert('error', 'Seuls les fichiers PDF, Word (DOCX), PowerPoint (PPTX) et Excel (XLSX) sont autorisés');
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showAlert('error', 'Le fichier est trop volumineux (maximum 50 Mo)');
    return;
  }

  currentFile = file;
  document.getElementById('upload-btn').style.display = 'inline-block';
  showAlert('info', `Fichier sélectionné: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} Mo)`);
}

async function uploadCurrentFile() {
  if (!currentFile) {
    showAlert('error', 'Aucun fichier sélectionné');
    return;
  }

  const uploadBtn = document.getElementById('upload-btn');
  const formData = new FormData();
  formData.append('pdf', currentFile);

  try {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Upload en cours...';

    const response = await fetch(`/api/devoirs/${assignmentId}/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });

    const data = await response.json();

    if (response.ok) {
      showAlert('success', 'Fichier uploadé avec succès !');
      currentFile = null;
      document.getElementById('file-input').value = '';
      uploadBtn.style.display = 'none';
      loadFiles();
    } else {
      showAlert('error', data.error || 'Erreur lors de l\'upload');
    }
  } catch (error) {
    console.error('Upload error:', error);
    showAlert('error', 'Erreur de connexion au serveur');
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Uploader le fichier';
  }
}

async function deleteFile(fileId) {
  if (!confirm('Êtes-vous sûr de vouloir supprimer ce fichier ?')) {
    return;
  }

  try {
    const response = await fetch(`/api/devoirs/fichiers/${fileId}`, {
      method: 'DELETE',
      headers: authHeaders()
    });

    const data = await response.json();

    if (response.ok) {
      showAlert('success', 'Fichier supprimé avec succès');
      loadFiles();
    } else {
      showAlert('error', data.error || 'Erreur lors de la suppression');
    }
  } catch (error) {
    console.error('Delete error:', error);
    showAlert('error', 'Erreur de connexion au serveur');
  }
}

function setupEventListeners() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');

  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });

  document.getElementById('upload-btn').addEventListener('click', uploadCurrentFile);

  document.getElementById('files-list').addEventListener('click', (e) => {
    const button = e.target.closest('.delete-file-btn');
    if (button) deleteFile(Number(button.dataset.id));
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    window.location.href = '/dashboard';
  });
}

setupEventListeners();

document.addEventListener('DOMContentLoaded', async () => {
  await loadAssignmentInfo();
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.classList.add('hidden');
});

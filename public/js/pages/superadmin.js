import { apiCall, checkAuth, logout } from "../utils/api.js?v=3";
import { escapeHTML, toggleModal, setupModalClose, showAlert, showConfirm } from "../utils/dom.js?v=2";

let classes = [];
let admins = [];
let invitations = [];
let etabRequests = [];

async function init() {
  const auth = await checkAuth();

  document.getElementById(
    "user-info"
  ).textContent = `SuperAdmin: ${auth.username}`;

  document.getElementById("logout-btn").addEventListener("click", logout);

  setupTabs();
  setupClasseModal();
  setupAdminModal();
  setupEtabRequestModal();

  await loadClasses();
  await loadAdmins();
  await loadInvitations();
  await loadEtabRequests();
}

function setupTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.dataset.tab;

      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(`tab-${tabName}`).classList.add("active");
    });
  });
}

function setupClasseModal() {
  const addBtn = document.getElementById("add-classe-btn");
  const addForm = document.getElementById("add-classe-form");
  const editForm = document.getElementById("edit-classe-form");

  addBtn.addEventListener("click", () => {
    toggleModal("add-classe-modal", true);
  });

  setupModalClose("add-classe-modal", "close-add-classe-modal");
  setupModalClose("edit-classe-modal", "close-edit-classe-modal");

  document
    .getElementById("cancel-add-classe-btn")
    .addEventListener("click", () => {
      toggleModal("add-classe-modal", false);
    });

  document
    .getElementById("cancel-edit-classe-btn")
    .addEventListener("click", () => {
      toggleModal("edit-classe-modal", false);
    });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nom = document.getElementById("add-classe-nom").value;

    const data = await apiCall("/api/superadmin/classes", {
      method: "POST",
      body: JSON.stringify({ nom }),
    });

    if (data.success) {
      toggleModal("add-classe-modal", false);
      addForm.reset();
      await loadClasses();
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
    }
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-classe-id").value;
    const nom = document.getElementById("edit-classe-nom").value;

    const data = await apiCall(`/api/superadmin/classes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nom }),
    });

    if (data.success) {
      toggleModal("edit-classe-modal", false);
      await loadClasses();
      await loadAdmins();
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
    }
  });
}

function setupAdminModal() {
  const addBtn = document.getElementById("add-admin-btn");
  const addForm = document.getElementById("add-admin-form");
  const editForm = document.getElementById("edit-admin-form");

  addBtn.addEventListener("click", () => {
    populateClasseSelects();
    toggleModal("add-admin-modal", true);
  });

  setupModalClose("add-admin-modal", "close-add-admin-modal");
  setupModalClose("edit-admin-modal", "close-edit-admin-modal");

  document
    .getElementById("cancel-add-admin-btn")
    .addEventListener("click", () => {
      toggleModal("add-admin-modal", false);
    });

  document
    .getElementById("cancel-edit-admin-btn")
    .addEventListener("click", () => {
      toggleModal("edit-admin-modal", false);
    });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById('add-admin-email').value;
    const classe_id = document.getElementById('add-admin-classe').value;

    const data = await apiCall('/api/invitations/create', {
      method: 'POST',
      body: JSON.stringify({ email, role: 'admin', classe_id }),
    });

    if (data.success) {
      await showAlert('Invitation envoyée avec succès à ' + email, 'Succès');
      toggleModal('add-admin-modal', false);
      addForm.reset();
      await loadAdmins();
      await loadInvitations();
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
    }
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-admin-id").value;
    const username = document.getElementById("edit-admin-username").value;
    const password = document.getElementById("edit-admin-password").value;
    const classe_id = document.getElementById("edit-admin-classe").value;

    const body = { username, classe_id };
    if (password) {
      body.password = password;
    }

    const data = await apiCall(`/api/superadmin/admins/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    if (data.success) {
      toggleModal("edit-admin-modal", false);
      await loadAdmins();
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
    }
  });
}

function populateClasseSelects() {
  const addSelect = document.getElementById("add-admin-classe");
  const editSelect = document.getElementById("edit-admin-classe");

  [addSelect, editSelect].forEach((select) => {
    while (select.children.length > 1) {
      select.removeChild(select.lastChild);
    }

    classes.forEach((classe) => {
      const option = document.createElement("option");
      option.value = classe.id;
      option.textContent = classe.nom;
      select.appendChild(option);
    });
  });
}

async function loadClasses() {
  const data = await apiCall("/api/superadmin/classes");
  if (data.classes) {
    classes = data.classes;
    renderClasses();
  }
}

function renderClasses() {
  const container = document.getElementById("classes-list");
  container.innerHTML = "";

  if (classes.length === 0) {
    container.innerHTML = "<p>Aucune classe pour le moment.</p>";
    return;
  }

  classes.forEach((classe) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHTML(classe.nom)}</h3>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-classe-btn" data-id="${
          classe.id
        }">Modifier</button>
        <button class="btn-danger delete-classe-btn" data-id="${
          classe.id
        }">Supprimer</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".edit-classe-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openEditClasseModal(parseInt(btn.dataset.id))
    );
  });

  document.querySelectorAll(".delete-classe-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteClasse(parseInt(btn.dataset.id)));
  });
}

function openEditClasseModal(id) {
  const classe = classes.find((c) => c.id === id);
  if (!classe) return;

  document.getElementById("edit-classe-id").value = classe.id;
  document.getElementById("edit-classe-nom").value = classe.nom;
  toggleModal("edit-classe-modal", true);
}

async function deleteClasse(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cette classe ? Tous les utilisateurs, matières et devoirs associés seront également supprimés.', 'Confirmation');
  if (!confirmed) {
    return;
  }

  const data = await apiCall(`/api/superadmin/classes/${id}`, {
    method: "DELETE",
  });

  if (data.success) {
    await loadClasses();
    await loadAdmins();
  }
}

async function loadAdmins() {
  const data = await apiCall("/api/superadmin/admins");
  if (data.admins) {
    admins = data.admins;
    renderAdmins();
  }
}

function renderAdmins() {
  const container = document.getElementById("admins-list");
  container.innerHTML = "";

  if (admins.length === 0) {
    container.innerHTML = "<p>Aucun administrateur pour le moment.</p>";
    return;
  }

  admins.forEach((admin) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="list-item-info">
      <h3>${escapeHTML(admin.username)}</h3>
      <p>${escapeHTML(admin.classe_nom || "Aucune classe")}</p>
      </div>
      <div class="list-item-actions">
      <button class="btn btn-secondary edit-admin-btn" data-id="${
        admin.id
      }" style="padding:8px 12px;border-radius:4px;border:1px solid #bdbdbd;background:#f6f6f6;color:#222;">Modifier</button>
      <button class="btn btn-danger delete-admin-btn" data-id="${
        admin.id
      }" style="padding:8px 12px;border-radius:4px;border:1px solid #b71c1c;background:#d32f2f;color:#fff;">Supprimer</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".edit-admin-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openEditAdminModal(parseInt(btn.dataset.id))
    );
  });

  document.querySelectorAll(".delete-admin-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteAdmin(parseInt(btn.dataset.id)));
  });
}

function openEditAdminModal(id) {
  const admin = admins.find((a) => a.id === id);
  if (!admin) return;

  populateClasseSelects();
  document.getElementById("edit-admin-id").value = admin.id;
  document.getElementById("edit-admin-username").value = admin.username;
  document.getElementById("edit-admin-password").value = "";
  document.getElementById("edit-admin-classe").value = admin.classe_id || "";
  toggleModal("edit-admin-modal", true);
}

async function deleteAdmin(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cet administrateur ?', 'Confirmation');
  if (!confirmed) {
    return;
  }

  const data = await apiCall(`/api/superadmin/admins/${id}`, {
    method: "DELETE",
  });

  if (data.success) {
    await loadAdmins();
  }
}

async function loadInvitations() {
  const data = await apiCall("/api/invitations/list");
  if (data && Array.isArray(data)) {
    invitations = data;
    renderInvitations();
  }
}

function renderInvitations() {
  const container = document.getElementById("invitations-list");
  container.innerHTML = "";

  if (invitations.length === 0) {
    container.innerHTML = "<p>Aucune invitation en attente.</p>";
    return;
  }

  invitations.forEach((invitation) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const createdDate = new Date(invitation.created_at).toLocaleDateString('fr-FR');
    const expiresDate = new Date(invitation.expires_at).toLocaleDateString('fr-FR');

    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHTML(invitation.email)}</h3>
        <p>Classe: ${escapeHTML(invitation.classe_nom || 'Aucune')}</p>
        <p style="font-size: 0.8rem; color: var(--secondary);">
          Envoyée le ${createdDate} - Expire le ${expiresDate}
        </p>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary resend-invitation-btn" data-id="${invitation.id}">Renvoyer l'email</button>
        <button class="btn-danger delete-invitation-btn" data-id="${invitation.id}">Supprimer</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".resend-invitation-btn").forEach((btn) => {
    btn.addEventListener("click", () => resendInvitation(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll(".delete-invitation-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteInvitation(parseInt(btn.dataset.id)));
  });
}

async function resendInvitation(id) {
  const data = await apiCall(`/api/invitations/resend/${id}`, {
    method: "POST",
  });

  if (data.success) {
    await showAlert(data.message, 'Succès');
  } else if (data.error) {
    await showAlert(data.error, 'Erreur');
  }
}

async function deleteInvitation(id) {
  const confirmed = await showConfirm('Êtes-vous sûr de vouloir supprimer cette invitation ?', 'Confirmation');
  if (!confirmed) {
    return;
  }

  const data = await apiCall(`/api/invitations/${id}`, {
    method: "DELETE",
  });

  if (data.success) {
    await loadInvitations();
  } else if (data.error) {
    await showAlert(data.error, 'Erreur');
  }
}

// --- Etablissement requests ---

function setupEtabRequestModal() {
  const acceptForm = document.getElementById("accept-etab-form");

  setupModalClose("accept-etab-modal", "close-accept-etab-modal");

  document
    .getElementById("cancel-accept-etab-btn")
    .addEventListener("click", () => {
      toggleModal("accept-etab-modal", false);
    });

  acceptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("accept-etab-id").value;
    const nom = document.getElementById("accept-etab-nom").value;
    const commune = document.getElementById("accept-etab-commune").value;
    const code_postal = document.getElementById("accept-etab-cp").value;

    const data = await apiCall(`/api/superadmin/etablissement-requests/${id}/accept`, {
      method: "POST",
      body: JSON.stringify({ nom, commune, code_postal }),
    });

    if (data.success) {
      toggleModal("accept-etab-modal", false);
      await showAlert("Établissement créé avec succès", "Succès");
      await loadEtabRequests();
    } else if (data.error) {
      await showAlert(data.error, "Erreur");
    }
  });
}

async function loadEtabRequests() {
  const data = await apiCall("/api/superadmin/etablissement-requests");
  if (data.requests) {
    etabRequests = data.requests;
    renderEtabRequests();
  }
}

function renderEtabRequests() {
  const container = document.getElementById("etab-requests-list");
  container.innerHTML = "";

  if (etabRequests.length === 0) {
    container.innerHTML = "<p>Aucune demande en attente.</p>";
    return;
  }

  etabRequests.forEach((request) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const createdDate = new Date(request.created_at).toLocaleDateString("fr-FR");

    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHTML(request.nom)}</h3>
        <p>${escapeHTML(request.commune || "")} ${request.code_postal ? "(" + escapeHTML(request.code_postal) + ")" : ""}</p>
        <p style="font-size: 0.85rem; color: var(--secondary);">
          Demandeur : ${escapeHTML(request.email_demandeur || "")} - ${createdDate}
        </p>
      </div>
      <div class="list-item-actions">
        <button class="btn-primary accept-etab-btn" data-id="${request.id}">Accepter</button>
        <button class="btn-danger reject-etab-btn" data-id="${request.id}">Refuser</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".accept-etab-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAcceptEtabModal(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll(".reject-etab-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectEtabRequest(parseInt(btn.dataset.id)));
  });
}

function openAcceptEtabModal(id) {
  const request = etabRequests.find((r) => r.id === id);
  if (!request) return;

  document.getElementById("accept-etab-id").value = request.id;
  document.getElementById("accept-etab-nom").value = request.nom;
  document.getElementById("accept-etab-commune").value = request.commune || "";
  document.getElementById("accept-etab-cp").value = request.code_postal || "";
  toggleModal("accept-etab-modal", true);
}

async function rejectEtabRequest(id) {
  const confirmed = await showConfirm("Êtes-vous sûr de vouloir refuser cette demande ?", "Confirmation");
  if (!confirmed) return;

  const data = await apiCall(`/api/superadmin/etablissement-requests/${id}/reject`, {
    method: "POST",
  });

  if (data.success) {
    await loadEtabRequests();
  } else if (data.error) {
    await showAlert(data.error, "Erreur");
  }
}

init();

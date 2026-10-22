import { apiCall, checkAuth, logout } from "../utils/api.js";
import { escapeHtml, toggleModal, setupModalClose, showAlert, showConfirm } from "../utils/dom.js";

let classes = [];
let admins = [];
let invitations = [];
let schoolRequests = [];

async function init() {
  const auth = await checkAuth();

  document.getElementById(
    "user-info"
  ).textContent = `SuperAdmin: ${auth.username}`;

  document.getElementById("logout-btn").addEventListener("click", logout);

  setupTabs();
  setupClassModal();
  setupAdminModal();
  setupSchoolRequestModal();

  await loadClasses();
  await loadAdmins();
  await loadInvitations();
  await loadSchoolRequests();
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

function setupClassModal() {
  const addBtn = document.getElementById("add-class-btn");
  const addForm = document.getElementById("add-class-form");
  const editForm = document.getElementById("edit-class-form");

  addBtn.addEventListener("click", () => {
    toggleModal("add-class-modal", true);
  });

  setupModalClose("add-class-modal", "close-add-class-modal");
  setupModalClose("edit-class-modal", "close-edit-class-modal");

  document
    .getElementById("cancel-add-class-btn")
    .addEventListener("click", () => {
      toggleModal("add-class-modal", false);
    });

  document
    .getElementById("cancel-edit-class-btn")
    .addEventListener("click", () => {
      toggleModal("edit-class-modal", false);
    });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("add-class-name").value;

    const data = await apiCall("/api/superadmin/classes", {
      method: "POST",
      body: JSON.stringify({ nom: name }),
    });

    if (data.success) {
      toggleModal("add-class-modal", false);
      addForm.reset();
      await loadClasses();
    } else if (data.error) {
      await showAlert(data.error, 'Erreur');
    }
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-class-id").value;
    const name = document.getElementById("edit-class-name").value;

    const data = await apiCall(`/api/superadmin/classes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ nom: name }),
    });

    if (data.success) {
      toggleModal("edit-class-modal", false);
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
    populateClassSelects();
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
    const classId = document.getElementById('add-admin-class').value;

    const data = await apiCall('/api/invitations/create', {
      method: 'POST',
      body: JSON.stringify({ email, role: 'admin', classe_id: classId }),
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
    const classId = document.getElementById("edit-admin-class").value;

    const body = { username, classe_id: classId };
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

function populateClassSelects() {
  const addSelect = document.getElementById("add-admin-class");
  const editSelect = document.getElementById("edit-admin-class");

  [addSelect, editSelect].forEach((select) => {
    while (select.children.length > 1) {
      select.removeChild(select.lastChild);
    }

    classes.forEach((schoolClass) => {
      const option = document.createElement("option");
      option.value = schoolClass.id;
      option.textContent = schoolClass.nom;
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

  classes.forEach((schoolClass) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHtml(schoolClass.nom)}</h3>
        <label class="checkbox-container">
          <input type="checkbox" class="premium-class-checkbox" data-id="${
            schoolClass.id
          }" ${schoolClass.premium ? "checked" : ""}>
          QCM autorisés (génération gratuite)
        </label>
      </div>
      <div class="list-item-actions">
        <button class="btn-secondary edit-class-btn" data-id="${
          schoolClass.id
        }">Modifier</button>
        <button class="btn-danger delete-class-btn" data-id="${
          schoolClass.id
        }">Supprimer</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".edit-class-btn").forEach((btn) => {
    btn.addEventListener("click", () =>
      openEditClassModal(parseInt(btn.dataset.id))
    );
  });

  document.querySelectorAll(".delete-class-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteClass(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll(".premium-class-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () =>
      toggleClassPremium(parseInt(checkbox.dataset.id), checkbox.checked, checkbox)
    );
  });
}

async function toggleClassPremium(id, premium, checkbox) {
  const data = await apiCall(`/api/superadmin/classes/${id}/premium`, {
    method: "PUT",
    body: JSON.stringify({ premium }),
  });

  if (data.error) {
    checkbox.checked = !premium;
    await showAlert(data.error, "Erreur");
    return;
  }

  const schoolClass = classes.find((c) => c.id === id);
  if (schoolClass) schoolClass.premium = premium;
}

function openEditClassModal(id) {
  const schoolClass = classes.find((c) => c.id === id);
  if (!schoolClass) return;

  document.getElementById("edit-class-id").value = schoolClass.id;
  document.getElementById("edit-class-name").value = schoolClass.nom;
  toggleModal("edit-class-modal", true);
}

async function deleteClass(id) {
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
      <h3>${escapeHtml(admin.username)}</h3>
      <p>${escapeHtml(admin.classe_nom || "Aucune classe")}</p>
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

  populateClassSelects();
  document.getElementById("edit-admin-id").value = admin.id;
  document.getElementById("edit-admin-username").value = admin.username;
  document.getElementById("edit-admin-password").value = "";
  document.getElementById("edit-admin-class").value = admin.classe_id || "";
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
        <h3>${escapeHtml(invitation.email)}</h3>
        <p>Classe: ${escapeHtml(invitation.classe_nom || 'Aucune')}</p>
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

function setupSchoolRequestModal() {
  const acceptForm = document.getElementById("accept-school-form");

  setupModalClose("accept-school-modal", "close-accept-school-modal");

  document
    .getElementById("cancel-accept-school-btn")
    .addEventListener("click", () => {
      toggleModal("accept-school-modal", false);
    });

  acceptForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("accept-school-id").value;
    const name = document.getElementById("accept-school-name").value;
    const city = document.getElementById("accept-school-city").value;
    const postcode = document.getElementById("accept-school-postcode").value;

    const data = await apiCall(`/api/superadmin/etablissement-requests/${id}/accept`, {
      method: "POST",
      body: JSON.stringify({ nom: name, commune: city, code_postal: postcode }),
    });

    if (data.success) {
      toggleModal("accept-school-modal", false);
      await showAlert("Établissement créé avec succès", "Succès");
      await loadSchoolRequests();
    } else if (data.error) {
      await showAlert(data.error, "Erreur");
    }
  });
}

async function loadSchoolRequests() {
  const data = await apiCall("/api/superadmin/etablissement-requests");
  if (data.requests) {
    schoolRequests = data.requests;
    renderSchoolRequests();
  }
}

function renderSchoolRequests() {
  const container = document.getElementById("school-requests-list");
  container.innerHTML = "";

  if (schoolRequests.length === 0) {
    container.innerHTML = "<p>Aucune demande en attente.</p>";
    return;
  }

  schoolRequests.forEach((request) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const createdDate = new Date(request.created_at).toLocaleDateString("fr-FR");

    item.innerHTML = `
      <div class="list-item-info">
        <h3>${escapeHtml(request.nom)}</h3>
        <p>${escapeHtml(request.commune || "")} ${request.code_postal ? "(" + escapeHtml(request.code_postal) + ")" : ""}</p>
        <p style="font-size: 0.85rem; color: var(--secondary);">
          Demandeur : ${escapeHtml(request.email_demandeur || "")} - ${createdDate}
        </p>
      </div>
      <div class="list-item-actions">
        <button class="btn-primary accept-school-btn" data-id="${request.id}">Accepter</button>
        <button class="btn-danger reject-school-btn" data-id="${request.id}">Refuser</button>
      </div>
    `;
    container.appendChild(item);
  });

  document.querySelectorAll(".accept-school-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAcceptSchoolModal(parseInt(btn.dataset.id)));
  });

  document.querySelectorAll(".reject-school-btn").forEach((btn) => {
    btn.addEventListener("click", () => rejectSchoolRequest(parseInt(btn.dataset.id)));
  });
}

function openAcceptSchoolModal(id) {
  const request = schoolRequests.find((r) => r.id === id);
  if (!request) return;

  document.getElementById("accept-school-id").value = request.id;
  document.getElementById("accept-school-name").value = request.nom;
  document.getElementById("accept-school-city").value = request.commune || "";
  document.getElementById("accept-school-postcode").value = request.code_postal || "";
  toggleModal("accept-school-modal", true);
}

async function rejectSchoolRequest(id) {
  const confirmed = await showConfirm("Êtes-vous sûr de vouloir refuser cette demande ?", "Confirmation");
  if (!confirmed) return;

  const data = await apiCall(`/api/superadmin/etablissement-requests/${id}/reject`, {
    method: "POST",
  });

  if (data.success) {
    await loadSchoolRequests();
  } else if (data.error) {
    await showAlert(data.error, "Erreur");
  }
}

init();

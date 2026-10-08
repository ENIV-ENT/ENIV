import { apiCall, checkAuth, clearApiCache } from "../utils/api.js?v=4";

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const boiteNomUtilisateur = document.getElementById("username");
const boiteMotDePasse = document.getElementById("password");

// Elements pour la modal mot de passe oublié
const forgotPasswordLink = document.getElementById("forgot-password-link");
const forgotPasswordModal = document.getElementById("forgot-password-modal");
const closeModal = document.querySelector(".close");

async function init() {
  await checkAuth();

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = boiteNomUtilisateur.value;
    const password = boiteMotDePasse.value;

    const data = await apiCall("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    if (username === "" || password === "") {
      loginError.textContent = "Veuillez remplir tous les champs.";
      boiteMotDePasse.style.borderColor = "red";
      boiteNomUtilisateur.style.borderColor = "red";
      return;
    }

    if (data.error) {
      loginError.textContent = data.error;
      boiteMotDePasse.style.borderColor = "red";
      boiteNomUtilisateur.style.borderColor = "red";
    } else {
      loginError.textContent = "";
      // Stocker le token JWT dans localStorage
      if (data.token) {
        localStorage.setItem('token', data.token);
      }
      await clearApiCache();
      switch (data.role) {
        case "superadmin":
          window.location.href = "/superadmin/dashboard/";
          break;
        default:
          window.location.href = "/dashboard/";
          break;
      }
    }
  });

  // Permettre la soumission du formulaire avec la touche Entrée dans les champs
  boiteNomUtilisateur.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

  boiteMotDePasse.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

  // Gestion de la modal mot de passe oublié
  forgotPasswordLink.addEventListener("click", (e) => {
    e.preventDefault();
    forgotPasswordModal.style.display = "block";
  });

  closeModal.addEventListener("click", () => {
    forgotPasswordModal.style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target === forgotPasswordModal) {
      forgotPasswordModal.style.display = "none";
    }
  });
}

init();

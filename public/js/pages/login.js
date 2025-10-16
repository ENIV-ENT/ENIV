import { apiCall, checkAuth } from "../utils/api.js";

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const boiteNomUtilisateur = document.getElementById("username");
const boiteMotDePasse = document.getElementById("password");
//console.log(boiteNomUtilisateur);
//console.log(boiteMotDePasse);

async function init() {
  await checkAuth();

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

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
      switch (data.role) {
        case 'superadmin':
          window.location.href = "/superadmin/dashboard/";
          break;
        case "admin":
          window.location.href = "/admin/dashboard/";
          break;
        default:
          window.location.href = "/dashboard/";
          break;
      }
    }
  });
}

init();

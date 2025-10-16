import { apiCall, checkAuth } from "../utils/api.js";

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const boiteNomUtilisateur = document.getElementById("username");
const boiteMotDePasse = document.getElementById("password");
//console.log(boiteNomUtilisateur);
//console.log(boiteMotDePasse);

async function init() {
  const auth = await checkAuth();

  if (auth.authenticated) {
    if (auth.role === "superadmin") {
      window.location.href = "/superadmin/dashboard";
    } else if (auth.role === "admin") {
      window.location.href = "/admin/dashboard";
    } else {
      window.location.href = "/dashboard";
    }
    return;
  }
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
      if (data.role === "superadmin") {
        window.location.href = "/superadmin/dashboard";
      }
      if (data.role === "admin") {
        window.location.href = "/admin/dashboard";
      } else {
        window.location.href = "/dashboard";
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
}

init();

import { apiCall, checkAuth, clearApiCache } from "../utils/api.js";

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");

const forgotPasswordLink = document.getElementById("forgot-password-link");
const forgotPasswordModal = document.getElementById("forgot-password-modal");
const closeModal = document.querySelector(".close");

async function init() {
  await checkAuth();

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = usernameInput.value;
    const password = passwordInput.value;

    const data = await apiCall("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    if (username === "" || password === "") {
      loginError.textContent = "Veuillez remplir tous les champs.";
      passwordInput.style.borderColor = "red";
      usernameInput.style.borderColor = "red";
      return;
    }

    if (data.error) {
      loginError.textContent = data.error;
      passwordInput.style.borderColor = "red";
      usernameInput.style.borderColor = "red";
    } else {
      loginError.textContent = "";
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

  usernameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

  passwordInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });

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

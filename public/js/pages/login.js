import { apiCall, checkAuth } from '../utils/api.js';

async function init() {
  const auth = await checkAuth();

  if (auth.authenticated) {
    if (auth.role === 'admin') {
      window.location.href = '/admin/dashboard';
    } else {
      window.location.href = '/dashboard';
    }
    return;
  }

  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const data = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (data.error) {
      loginError.textContent = data.error;
    } else {
      loginError.textContent = '';
      if (data.role === 'admin') {
        window.location.href = '/admin/dashboard';
      } else {
        window.location.href = '/dashboard';
      }
    }
  });
}

init();

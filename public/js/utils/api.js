export async function apiCall(url, options = {}) {
  try {
    const token = localStorage.getItem('token');

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

function setLoadingScreenVisible(visible) {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.classList.toggle('hidden', !visible);
  }
}

function getExpectedPaths(role) {
  const commonPaths = ["/settings/", "/quiz/", "/devoir-pdf/"];

  if (role === 'superadmin') {
    return ["/superadmin/dashboard/", ...commonPaths];
  }
  if (role === 'admin') {
    return ["/dashboard/", "/admin/", "/admin/dashboard/", ...commonPaths];
  }
  return ["/dashboard/", ...commonPaths];
}

function normalizePath(path) {
  return path.endsWith('/') ? path : path + '/';
}

export async function checkAuth() {
  setLoadingScreenVisible(true);

  const AUTH_TIMEOUT_MS = 8000;

  let data;
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), AUTH_TIMEOUT_MS)
    );
    data = await Promise.race([apiCall('/api/auth/me'), timeout]);
  } catch {
    // Timeout ou erreur réseau : déconnecter l'utilisateur
    localStorage.removeItem('token');
    window.location.href = '/';
    return { authenticated: false };
  }

  if (!data || !data.authenticated || data.error) {
    const publicPaths = ["/", "/register/"];
    if (!publicPaths.includes(normalizePath(window.location.pathname))) {
      localStorage.removeItem('token');
      window.location.href = "/";
      return { authenticated: false };
    }

    setLoadingScreenVisible(false);
    return { authenticated: false };
  }

  console.log('User role:', data.role);

  const expectedPaths = getExpectedPaths(data.role);
  const currentPath = normalizePath(window.location.pathname);

  if (!expectedPaths.includes(currentPath)) {
    window.location.href = expectedPaths[0];
    return data;
  }

  setLoadingScreenVisible(false);
  return data;
}

export async function logout() {
  await apiCall('/api/auth/logout', { method: 'POST' });
  localStorage.removeItem('token');
  window.location.href = '/';
}

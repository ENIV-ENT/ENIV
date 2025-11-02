export async function apiCall(url, options = {}) {
  try {
    // Récupérer le token depuis localStorage
    const token = localStorage.getItem('token');

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    // Pour toutes les réponses, essayer de parser le JSON
    // (même les erreurs 400, 500, etc. peuvent contenir un message d'erreur)
    const data = await response.json();

    // Si la réponse n'est pas ok, le JSON contient probablement un champ "error"
    // On le retourne tel quel pour que l'appelant puisse afficher le message
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

export async function checkAuth() {
  const data = await apiCall('/api/auth/me');
  let expectedPaths;
  let returnData;

  if (data.authenticated) {
    if (data.role === 'superadmin') {
      expectedPaths = ["/superadmin/dashboard/"];
    } else if (data.role === "admin") {
      expectedPaths = ["/admin/dashboard/"];
    } else {
      expectedPaths = ["/dashboard/", "/settings/"];
    }

    returnData = {
      authenticated: true,
      userId: data.userId,
      username: data.username,
      role: data.role
    };
  } else {
    expectedPaths = ["/"];
    returnData = { authenticated: false };
  }
  if (!expectedPaths.includes(window.location.pathname)) {
    window.location.href = expectedPaths[0];
  }

  return returnData;
}

export async function logout() {
  await apiCall('/api/auth/logout', { method: 'POST' });
  // Supprimer le token du localStorage
  localStorage.removeItem('token');
  window.location.href = '/';
}

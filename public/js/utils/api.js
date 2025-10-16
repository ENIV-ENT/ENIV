export async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok && response.status !== 401 && response.status !== 403) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

export async function checkAuth() {
  const data = await apiCall('/api/auth/me');

  if (data.authenticated) {
    return {
      authenticated: true,
      userId: data.userId,
      username: data.username,
      role: data.role
    };
  }

  return { authenticated: false };
}

export async function logout() {
  await apiCall('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

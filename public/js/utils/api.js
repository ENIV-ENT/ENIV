export async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
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
  window.location.href = '/';
}

import { getRealtimeId } from './realtime.js';

// Séparé de api.js pour que les modules importés par api.js (push.js) puissent
// appeler l'API sans créer de cycle d'imports : scripts/version-assets.js ne
// sait pas versionner deux fichiers qui s'importent l'un l'autre.
export async function apiCall(url, options = {}) {
  try {
    const token = localStorage.getItem('token');
    // Évite que l'onglet à l'origine d'une modification reçoive sa propre
    // notification temps réel, et donc qu'il recharge deux fois les mêmes données.
    const realtimeId = getRealtimeId();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(realtimeId ? { 'X-Realtime-Id': realtimeId } : {}),
        ...options.headers,
      },
    });

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return { error: error.message };
  }
}

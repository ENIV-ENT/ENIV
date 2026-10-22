import { getRealtimeId } from './realtime.js';

/**
 * Calls the API with the stored token and returns the parsed JSON body.
 *
 * Kept apart from api.js so that modules imported by api.js (push.js) can call
 * the API without an import cycle: scripts/versionAssets.js cannot version two
 * files that import each other.
 *
 * The X-Realtime-Id header keeps the tab that made a change from receiving its
 * own realtime notification and reloading the same data twice.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<object>} The response body, or `{ error }` on network failure.
 */
export async function apiCall(url, options = {}) {
  try {
    const token = localStorage.getItem('token');
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

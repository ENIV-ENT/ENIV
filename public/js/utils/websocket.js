let ws = null;

export function initWebSocket(onUpdate) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'update' && onUpdate) {
      onUpdate();
    }
  };

  ws.onclose = () => {
    setTimeout(() => initWebSocket(onUpdate), 3000);
  };
}

export function closeWebSocket() {
  if (ws) {
    ws.close();
  }
}

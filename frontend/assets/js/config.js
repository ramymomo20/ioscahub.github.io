window.HUB_CONFIG = {
  API_BASE_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:8080/api'
    : '/api',
  WS_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'ws://127.0.0.1:8080/ws/live'
    : ((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/live')
};

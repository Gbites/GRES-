(function () {
  'use strict';

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatINR(amount, symbol) {
    const settings = window.GresApp?.state?.settings;
    const sym = symbol || settings?.currency_symbol || '₹';
    const locale = settings?.customization?.advanced?.numberLocale || 'en-IN';
    const num = Number(amount || 0);
    return `${sym}${num.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function formatDate(raw, withTime = false) {
    if (!raw) return '';
    const d = new Date(String(raw).includes('T') ? raw : String(raw).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return String(raw);
    const settings = window.GresApp?.state?.settings;
    const tz = settings?.timezone || settings?.customization?.advanced?.timezone || 'Asia/Kolkata';
    const fmt = settings?.date_format || settings?.customization?.advanced?.dateFormat || 'DD/MM/YYYY';
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      const dateStr = fmt === 'MM/DD/YYYY'
        ? `${parts.month}/${parts.day}/${parts.year}`
        : fmt === 'YYYY-MM-DD'
        ? `${parts.year}-${parts.month}-${parts.day}`
        : `${parts.day}/${parts.month}/${parts.year}`;
      return withTime ? `${dateStr} ${parts.hour}:${parts.minute}` : dateStr;
    } catch {
      return d.toLocaleDateString();
    }
  }

  function maskPhone(phone) {
    const str = String(phone || '').trim();
    if (!str) return '';
    const masked = window.GresApp?.state?.settings?.customization?.advanced?.security?.maskCustomerPhone;
    if (!masked || str.length < 5) return str;
    return `${str.slice(0, 2)}${'*'.repeat(Math.max(2, str.length - 4))}${str.slice(-2)}`;
  }

  function compressImageFile(file, maxDim = 320) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('Please select a valid image file'));
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/webp', 0.85));
        };
        img.onerror = () => reject(new Error('Could not decode image'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function request(method, url, body) {
    const opts = {
      method,
      headers: {},
      credentials: 'same-origin'
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function toast(message, type = 'info') {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 220);
    }, 3400);
  }

  function playKdsChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const volRaw = window.GresApp?.state?.settings?.customization?.notifications?.soundVolume;
      const vol = Math.max(0.02, Math.min(1, Number(volRaw ?? 0.7))) * 0.18;
      const ctx = new AC();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);
        gain.gain.setValueAtTime(vol, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.26);
      });
    } catch {
      // ignore autoplay block
    }
  }

  function notifyEvent(eventKey, message, toastType = 'info') {
    const noti = window.GresApp?.state?.settings?.customization?.notifications || {};
    const events = noti.events || {};
    const channels = noti.channels || {};
    if (eventKey && events[eventKey] === false) return;
    if (channels.inAppToast !== false) {
      toast(message, toastType);
    }
    if (noti.soundEnabled !== false && window.GresApp?.state?.settings?.kds_sound_enabled !== 0) {
      playKdsChime();
    }
    if (channels.browserPush && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(window.GresApp?.state?.settings?.restaurant_name || 'GRES Alert', { body: message });
      } catch {
        // ignore browser notification error
      }
    }
  }

  let ws = null;
  let reconnectTimer = null;

  function connectWS(onEvent) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    const indicator = document.getElementById('wsIndicator');
    const wsText = document.getElementById('wsText');

    ws.onopen = () => {
      indicator?.classList.remove('offline');
      if (wsText) wsText.textContent = 'LIVE SYNC';
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onEvent(msg);
      } catch {
        // ignore malformed
      }
    };

    ws.onclose = () => {
      indicator?.classList.add('offline');
      if (wsText) wsText.textContent = 'RECONNECTING';
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => connectWS(onEvent), 2500);
    };
  }

  window.GresAPI = {
    esc,
    formatINR,
    formatDate,
    maskPhone,
    compressImageFile,
    toast,
    notifyEvent,
    playKdsChime,
    connectWS,
    get: (u) => request('GET', u),
    post: (u, b) => request('POST', u, b),
    put: (u, b) => request('PUT', u, b),
    patch: (u, b) => request('PATCH', u, b),
    del: (u) => request('DELETE', u)
  };
  window.BistroAPI = window.GresAPI;
})();

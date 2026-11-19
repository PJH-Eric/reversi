(function (root, factory) {
  const createBackendRouter = factory();
  if (typeof module === 'object' && module.exports) module.exports = { createBackendRouter };
  else root.createBackendRouter = createBackendRouter;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function socketProbe(endpoint) {
    return new Promise(resolve => {
      let socket;
      let timer;
      let settled = false;

      function finish(available) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (socket && socket.readyState < 2) socket.close();
        resolve(available);
      }

      try {
        const url = new URL(endpoint.websocketPath, endpoint.url + '/');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(url);
        socket.addEventListener('open', () => finish(true), { once: true });
        socket.addEventListener('error', () => finish(false), { once: true });
        socket.addEventListener('close', () => finish(false), { once: true });
        timer = setTimeout(() => finish(false), endpoint.timeoutMs);
      } catch {
        finish(false);
      }
    });
  }

  function createBackendRouter({ primary, standby, pin, probe = socketProbe }) {
    const pinned = [primary, standby].find(endpoint => endpoint?.id === pin);
    let selected = pinned;
    let pending;

    async function choose() {
      for (const endpoint of [primary, standby]) {
        if (!endpoint) continue;
        try {
          if (await probe(endpoint)) {
            selected = endpoint;
            return selected.url;
          }
        } catch {
          // Check the standby if the primary cannot accept a connection.
        }
      }
      return null;
    }

    return {
      get url() {
        return (selected || primary)?.url ?? null;
      },
      select() {
        if (selected) return Promise.resolve(selected.url);
        pending ??= choose().finally(() => { pending = undefined; });
        return pending;
      },
      pinInvite(url) {
        if (selected) url.searchParams.set('backend', selected.id);
        return url;
      }
    };
  }

  return createBackendRouter;
});

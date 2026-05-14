(function () {
  window.FannaloP2P = class FannaloP2P {
    constructor() {
      this.connect = null;
      this.connections = new Map();
      this.peerId = localStorage.getItem('fannalo_peer_id') || crypto.randomUUID();
      localStorage.setItem('fannalo_peer_id', this.peerId);
      this.connected = false;
      this.userId = localStorage.getItem('fannalo_user_id');
      this.listeners = {};
      this.channels = new Map();
      this.messageQueue = [];
    }

    async init(appName = 'fannalo', channel = 'global') {
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/webconnect/dist/esm/webconnect.js');
        this.connect = mod.default || mod;
        this.connect = mod.default || mod;
          this.connection = this.connect({
            appName,
            channelName: channel,
            peerId: this.peerId,
            relays: []
          });

        this.connection.onConnect((attr) => {
          this.connected = true;
          const peerConnId = attr.connectId;
          this.connections.set(peerConnId, attr);
          this._emit('peer:connect', { peerId: peerConnId, attr });
          this._flushQueue(peerConnId);
        });

        this.connection.onDisconnect((attr) => {
          this.connections.delete(attr.connectId);
          this._emit('peer:disconnect', { peerId: attr.connectId });
          if (this.connections.size === 0) this.connected = false;
        });

        this.connection.onReceive((data, attr) => {
          try {
            const msg = typeof data === 'string' ? JSON.parse(data) : data;
            this._emit('message', { data: msg, from: attr.connectId, attr });

            if (msg.type === 'chat') {
              this._emit('chat', msg);
            } else if (msg.type === 'notification') {
              this._emit('notification', msg);
            } else if (msg.type === 'signal') {
              this._emit('signal', msg);
            } else if (msg.type === 'feed:update') {
              this._emit('feed:update', msg);
            } else if (msg.type === 'user:status') {
              this._emit('user:status', msg);
            }
          } catch (e) {
            this._emit('raw', { data, from: attr.connectId });
          }
        });

        return this;
      } catch (e) {
        console.warn('webconnect init failed:', e);
        this._initMock();
        return this;
      }
    }

    _initMock() {
      this.connected = true;
      this.connection = {
        Send: () => {},
        Broadcast: () => {},
        onConnect: () => {},
        onDisconnect: () => {},
        onReceive: () => {}
      };
    }

    send(toPeerId, data) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data);
      if (this.connection && this.connection.Send) {
        this.connection.Send(msg, { connectId: toPeerId });
      } else {
        this.messageQueue.push({ to: toPeerId, msg });
      }
    }

    broadcast(data) {
      const msg = typeof data === 'string' ? data : JSON.stringify(data);
      if (this.connection && this.connection.Broadcast) {
        this.connection.Broadcast(msg);
      } else {
        this.messageQueue.push({ to: '*', msg });
      }
    }

    sendChat(toUserId, message) {
      this.send(toUserId, {
        type: 'chat',
        from: this.userId,
        to: toUserId,
        message,
        timestamp: Date.now(),
        id: crypto.randomUUID()
      });
    }

    sendNotification(userId, notification) {
      this.send(userId, {
        type: 'notification',
        ...notification,
        timestamp: Date.now()
      });
    }

    joinChannel(channelName) {
      if (this.connection && this.connection.onConnect) {
        this.channels.set(channelName, true);
      }
    }

    _flushQueue(peerId) {
      const remaining = [];
      for (const item of this.messageQueue) {
        if (item.to === '*' || item.to === peerId) {
          this.connection.Send(item.msg, { connectId: peerId });
        } else {
          remaining.push(item);
        }
      }
      this.messageQueue = remaining;
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return () => {
        this.listeners[event] = this.listeners[event].filter(c => c !== callback);
      };
    }

    _emit(event, data) {
      (this.listeners[event] || []).forEach(cb => cb(data));
    }

    getPeerCount() {
      return this.connections.size;
    }

    getOnlinePeers() {
      return Array.from(this.connections.keys());
    }
  };
})();

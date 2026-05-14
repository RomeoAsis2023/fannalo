(function () {
  window.FannaloSuperPeer = class FannaloSuperPeer {
    constructor(db, p2p) {
      this.db = db;
      this.p2p = p2p;
      this.isActive = false;
      this.maxConnections = 50;
      this.storageQuota = 500 * 1024 * 1024;
      this.relayedMessages = 0;
      this.cachedContent = new Map();
      this.peerRegistry = new Map();
      this.heartbeatInterval = null;
    }

    async activate(userId) {
      if (this.isActive) return;
      this.isActive = true;
      this.userId = userId;

      await this.db.updateUser(userId, { isSuperPeer: true });

      this.heartbeatInterval = setInterval(() => this._heartbeat(), 30000);

      this.p2p.on('peer:connect', (peer) => this._onPeerConnect(peer));
      this.p2p.on('peer:disconnect', (peer) => this._onPeerDisconnect(peer));

      this._broadcastStatus('superpeer:online');
      console.log('Super peer activated');
    }

    deactivate() {
      if (!this.isActive) return;
      this.isActive = false;

      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      if (this.userId) {
        this.db.updateUser(this.userId, { isSuperPeer: false });
      }

      this._broadcastStatus('superpeer:offline');
      console.log('Super peer deactivated');
    }

    _onPeerConnect(peer) {
      const peerId = peer.peerId || peer.attr?.connectId;
      if (!peerId) return;

      this.peerRegistry.set(peerId, {
        id: peerId,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        relayedCount: 0
      });

      this._sendPeerList(peerId);
    }

    _onPeerDisconnect(peer) {
      const peerId = peer.peerId || peer;
      this.peerRegistry.delete(peerId);
    }

    _sendPeerList(toPeerId) {
      const peers = Array.from(this.peerRegistry.entries()).map(([id, info]) => ({
        id,
        connectedAt: info.connectedAt
      }));

      this.p2p.send(toPeerId, {
        type: 'superpeer:peerlist',
        peers,
        timestamp: Date.now()
      });
    }

    async cacheContent(infoHash, data) {
      if (this._getStorageUsage() >= this.storageQuota) {
        this._evictOldest();
      }
      this.cachedContent.set(infoHash, {
        data,
        cachedAt: Date.now(),
        accessCount: 0
      });
    }

    getCachedContent(infoHash) {
      const cached = this.cachedContent.get(infoHash);
      if (cached) {
        cached.accessCount++;
        cached.lastAccess = Date.now();
        return cached.data;
      }
      return null;
    }

    async relayMessage(fromPeerId, message) {
      const targetPeers = Array.from(this.peerRegistry.keys())
        .filter(id => id !== fromPeerId);

      for (const peerId of targetPeers) {
        this.p2p.send(peerId, {
          type: 'superpeer:relay',
          originalFrom: fromPeerId,
          originalType: message.type,
          payload: message,
          relayedBy: this.userId,
          timestamp: Date.now()
        });
        this.relayedMessages++;
      }
    }

    _getStorageUsage() {
      let total = 0;
      for (const [, cached] of this.cachedContent) {
        total += cached.data?.length || 0;
      }
      return total;
    }

    _evictOldest() {
      let oldest = null;
      let oldestKey = null;
      for (const [key, cached] of this.cachedContent) {
        if (!oldest || cached.cachedAt < oldest.cachedAt) {
          oldest = cached;
          oldestKey = key;
        }
      }
      if (oldestKey) this.cachedContent.delete(oldestKey);
    }

    _heartbeat() {
      const now = Date.now();
      for (const [peerId, info] of this.peerRegistry) {
        if (now - info.lastSeen > 120000) {
          this.peerRegistry.delete(peerId);
        }
      }

      this._broadcastStatus('superpeer:heartbeat', {
        peerCount: this.peerRegistry.size,
        relayedMessages: this.relayedMessages,
        storageUsage: this._getStorageUsage()
      });
    }

    _broadcastStatus(type, extra = {}) {
      if (!this.p2p || !this.p2p.broadcast) return;
      this.p2p.broadcast({
        type,
        peerId: this.p2p.peerId,
        userId: this.userId,
        ...extra,
        timestamp: Date.now()
      });
    }

    getStats() {
      return {
        active: this.isActive,
        connectedPeers: this.peerRegistry.size,
        maxConnections: this.maxConnections,
        relayedMessages: this.relayedMessages,
        cachedItems: this.cachedContent.size,
        storageUsage: this._getStorageUsage(),
        storageQuota: this.storageQuota
      };
    }
  };
})();

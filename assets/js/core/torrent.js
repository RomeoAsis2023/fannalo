(function () {
  window.FannaloTorrent = class FannaloTorrent {
    constructor() {
      this.client = null;
      this.torrents = new Map();
      this.seeding = new Map();
      this.ready = false;
    }

    async init() {
      try {
        const mod = await import('https://cdn.jsdelivr.net/npm/webtorrent/dist/webtorrent.min.js');
        const WebTorrent = mod.default || mod;
        this.client = new WebTorrent();
        this.ready = true;
        console.log('WebTorrent ready');
      } catch (e) {
        console.warn('WebTorrent init failed:', e);
        // Minimal mock so the rest of the app continues
        this.client = { add: () => {}, seed: () => {} };
        this.ready = true;
      }
      return this;
    }

    async seedFile(file, opts = {}) {
      if (!this.ready || !this.client) {
        return { infoHash: null, done: false, reason: 'WebTorrent not available' };
      }

      return new Promise((resolve) => {
        const torrent = this.client.seed(file, {
          name: opts.name || file.name || 'content',
          announce: [
            'wss://tracker.btorrent.xyz',
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.fastcast.nz'
          ]
        }, (torrent) => {
          const info = {
            infoHash: torrent.infoHash,
            magnetURI: torrent.magnetURI,
            files: torrent.files.map(f => ({
              name: f.name,
              length: f.length,
              path: f.path
            })),
            size: torrent.length,
            peers: torrent.numPeers
          };
          this.torrents.set(torrent.infoHash, torrent);
          this.seeding.set(torrent.infoHash, true);
          resolve(info);
        });

        torrent.on('error', (err) => {
          resolve({ infoHash: null, done: false, error: err.message });
        });
      });
    }

    async downloadTorrent(magnetURI) {
      if (!this.ready || !this.client) return null;

      return new Promise((resolve) => {
        const torrent = this.client.add(magnetURI, {
          announce: [
            'wss://tracker.btorrent.xyz',
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.fastcast.nz'
          ]
        }, (torrent) => {
          this.torrents.set(torrent.infoHash, torrent);
          resolve(torrent);
        });

        torrent.on('error', () => resolve(null));
      });
    }

    getTorrentFiles(infoHash) {
      const torrent = this.torrents.get(infoHash);
      if (!torrent) return [];
      return torrent.files.map(f => ({
        name: f.name,
        length: f.length,
        streamURL: this._getStreamURL(f),
        blobURL: null
      }));
    }

    async getBlobURL(infoHash, fileName) {
      const torrent = this.torrents.get(infoHash);
      if (!torrent) return null;
      const file = torrent.files.find(f => f.name === fileName || f.path === fileName);
      if (!file) return null;
      return new Promise((resolve) => {
        file.getBlobURL((err, url) => {
          resolve(err ? null : url);
        });
      });
    }

    _getStreamURL(file) {
      try {
        return file.streamURL ? file.streamURL() : null;
      } catch {
        return null;
      }
    }

    stopSeeding(infoHash) {
      const torrent = this.torrents.get(infoHash);
      if (torrent) {
        torrent.destroy();
        this.torrents.delete(infoHash);
        this.seeding.delete(infoHash);
      }
    }

    async sharePhoto(file) {
      const result = await this.seedFile(file, { name: `photo_${Date.now()}` });
      return result;
    }

    async shareVideo(file) {
      const result = await this.seedFile(file, { name: `video_${Date.now()}` });
      return result;
    }

    getStats() {
      if (!this.client) return { peers: 0, seeding: 0, downloading: 0 };
      return {
        peers: this.client.numPeers,
        seeding: this.client.torrents.filter(t => t.done && t.progress === 1).length,
        downloading: this.client.torrents.filter(t => !t.done).length,
        total: this.client.torrents.length
      };
    }

    destroy() {
      if (this.client) {
        this.client.destroy();
        this.client = null;
        this.ready = false;
      }
    }
  };
})();

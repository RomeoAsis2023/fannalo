(function () {
  window.FannaloLive = class FannaloLive {
    constructor(db, p2p, auth, torrent) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
      this.torrent = torrent;
      this.isLive = false;
      this.stream = null;
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.viewers = new Set();
      this.activeStream = null;
      this.listeners = {};
    }

    async startStream(title, isPremium = false, price = 0) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true
      });

      this.isLive = true;

      const streamData = {
        type: 'live',
        authorId: this.auth.currentUser.id,
        title,
        isPremium,
        price,
        startedAt: Date.now(),
        viewers: 0,
        active: true
      };
      const id = await this.db.put(streamData);
      streamData.id = id;

      if (this.p2p && this.p2p.broadcast) {
        this.p2p.broadcast({
          type: 'live:started',
          streamId: id,
          authorId: this.auth.currentUser.id,
          title,
          timestamp: Date.now()
        });
      }

      this.activeStream = streamData;
      this._emit('live:started', streamData);
      return streamData;
    }

    async endStream() {
      if (!this.isLive) return;
      this.isLive = false;

      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }

      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      if (this.activeStream) {
        this.activeStream.active = false;
        this.activeStream.endedAt = Date.now();
        await this.db.put(this.activeStream);
      }

      if (this.p2p && this.p2p.broadcast) {
        this.p2p.broadcast({
          type: 'live:ended',
          streamId: this.activeStream?.id,
          authorId: this.auth.currentUser?.id,
          timestamp: Date.now()
        });
      }

      this._emit('live:ended', this.activeStream);
      this.activeStream = null;
      this.viewers.clear();
    }

    async getLiveStreams() {
      return await this.db.map({ query: { type: 'live', active: true } });
    }

    async joinStream(streamId) {
      const stream = await this.db.get(streamId);
      if (!stream) throw new Error('Stream not found');
      this.activeStream = stream;
      stream.viewers = (stream.viewers || 0) + 1;
      await this.db.put(stream);
      this.viewers.add(this.p2p?.peerId);

      if (this.p2p) {
        this.p2p.send(stream.authorId, {
          type: 'live:viewer_joined',
          streamId,
          viewerId: this.p2p.peerId,
          timestamp: Date.now()
        });
      }

      this._emit('live:joined', stream);
      return stream;
    }

    async leaveStream(streamId) {
      const stream = await this.db.get(streamId);
      if (stream) {
        stream.viewers = Math.max(0, (stream.viewers || 0) - 1);
        await this.db.put(stream);
      }
      this.viewers.delete(this.p2p?.peerId);
      this.activeStream = null;
    }

    async sendChat(message) {
      if (!this.activeStream) return;
      const chatMsg = {
        type: 'live:chat',
        streamId: this.activeStream.id,
        authorId: this.auth.currentUser?.id,
        displayName: this.auth.currentUser?.displayName || 'Anonymous',
        message,
        timestamp: Date.now()
      };

      if (this.p2p) {
        this.p2p.broadcast(chatMsg);
      }

      return chatMsg;
    }

    async getStreamChat(streamId) {
      return await this.db.map({ query: { type: 'live:chat', streamId } });
    }

    startRecording() {
      if (!this.stream) return;
      this.recordedChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'video/webm;codecs=vp9,opus'
      });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.start(1000);
    }

    async saveRecording() {
      if (this.recordedChunks.length === 0) return null;
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const file = new File([blob], `live_${Date.now()}.webm`, { type: 'video/webm' });

      let torrentInfo = null;
      if (this.torrent) {
        torrentInfo = await this.torrent.shareVideo(file);
      }

      const vod = {
        type: 'vod',
        authorId: this.auth.currentUser?.id,
        title: this.activeStream?.title || 'Live Replay',
        blobURL: URL.createObjectURL(blob),
        torrentInfo,
        duration: Date.now() - (this.activeStream?.startedAt || Date.now()),
        createdAt: Date.now()
      };
      const id = await this.db.put(vod);
      return { ...vod, id };
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
    }

    _emit(event, data) {
      (this.listeners[event] || []).forEach(cb => cb(data));
    }
  };
})();

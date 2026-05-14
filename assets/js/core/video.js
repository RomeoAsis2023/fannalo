(function () {
  window.FannaloVideo = class FannaloVideo {
    constructor(db, p2p, auth) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
      this.pc = null;
      this.localStream = null;
      this.remoteStream = null;
      this.activeCall = null;
      this.dataChannel = null;
      this.listeners = {};
      this.cameras = [];
      this.microphones = [];
    }

    async init() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        this.cameras = devices.filter(d => d.kind === 'videoinput');
        this.microphones = devices.filter(d => d.kind === 'audioinput');
      } catch (e) {
        console.warn('Cannot enumerate devices:', e);
      }

      if (this.p2p) {
        this.p2p.on('signal', (msg) => this._handleSignal(msg));
      }
    }

    async startLocalVideo(audio = true, video = true, deviceId = null) {
      const constraints = { audio, video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false };
      if (deviceId && video) {
        constraints.video = { ...constraints.video, deviceId: { exact: deviceId } };
      }
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.localStream;
    }

    async call(peerId) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      this.activeCall = { peerId, direction: 'outgoing', status: 'connecting' };
      this._emit('call:status', this.activeCall);

      const config = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      this.pc = new RTCPeerConnection(config);
      this.remoteStream = new MediaStream();

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
      }

      this.pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(t => this.remoteStream.addTrack(t));
        this._emit('remote:stream', this.remoteStream);
      };

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.p2p) {
          this.p2p.send(peerId, {
            type: 'signal',
            signal: { type: 'ice-candidate', candidate: event.candidate },
            from: this.p2p.peerId
          });
        }
      };

      this.pc.onconnectionstatechange = () => {
        this.activeCall.status = this.pc.connectionState;
        this._emit('call:status', this.activeCall);
        if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
          this.endCall();
        }
      };

      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel();
      };

      const dataChannel = this.pc.createDataChannel('chat');
      this.dataChannel = dataChannel;
      this._setupDataChannel();

      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      if (this.p2p) {
        this.p2p.send(peerId, {
          type: 'signal',
          signal: { type: 'offer', sdp: offer },
          from: this.p2p.peerId
        });
      }

      this.activeCall.status = 'ringing';
      this._emit('call:status', this.activeCall);
      return this.activeCall;
    }

    async answer(offerSdp, peerId) {
      this.activeCall = { peerId, direction: 'incoming', status: 'connecting' };
      this._emit('call:status', this.activeCall);

      const config = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      };

      this.pc = new RTCPeerConnection(config);
      this.remoteStream = new MediaStream();

      if (this.localStream) {
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
      }

      this.pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(t => this.remoteStream.addTrack(t));
        this._emit('remote:stream', this.remoteStream);
      };

      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.p2p) {
          this.p2p.send(peerId, {
            type: 'signal',
            signal: { type: 'ice-candidate', candidate: event.candidate },
            from: this.p2p.peerId
          });
        }
      };

      this.pc.onconnectionstatechange = () => {
        this.activeCall.status = this.pc.connectionState;
        this._emit('call:status', this.activeCall);
        if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
          this.endCall();
        }
      };

      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel();
      };

      await this.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      if (this.p2p) {
        this.p2p.send(peerId, {
          type: 'signal',
          signal: { type: 'answer', sdp: answer },
          from: this.p2p.peerId
        });
      }

      this.activeCall.status = 'connected';
      this._emit('call:status', this.activeCall);
      return this.activeCall;
    }

    async _handleSignal(msg) {
      if (!msg.signal) return;
      const { signal } = msg;

      if (signal.type === 'offer' && (!this.activeCall || this.activeCall.status === 'idle')) {
        this._emit('call:incoming', { sdp: signal.sdp, from: msg.from });
      } else if (signal.type === 'answer' && this.activeCall) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        this.activeCall.status = 'connected';
        this._emit('call:status', this.activeCall);
      } else if (signal.type === 'ice-candidate' && this.pc) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (e) {
          console.warn('ICE candidate error:', e);
        }
      }
    }

    _setupDataChannel() {
      if (!this.dataChannel) return;
      this.dataChannel.onmessage = (event) => {
        this._emit('dc:message', event.data);
      };
    }

    async switchCamera(deviceId) {
      if (!this.localStream) return;
      const tracks = this.localStream.getVideoTracks();
      if (tracks.length > 0) {
        tracks[0].stop();
        this.localStream.removeTrack(tracks[0]);
      }
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } }
      });
      const newTrack = newStream.getVideoTracks()[0];
      this.localStream.addTrack(newTrack);
      const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
    }

    async toggleMic() {
      if (!this.localStream) return false;
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
      return false;
    }

    async toggleCamera() {
      if (!this.localStream) return false;
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return videoTrack.enabled;
      }
      return false;
    }

    async shareScreen() {
      if (!this.pc) return;
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(videoTrack);
        videoTrack.onended = async () => {
          if (this.localStream) {
            const camTrack = this.localStream.getVideoTracks()[0];
            if (camTrack && sender) await sender.replaceTrack(camTrack);
          }
        };
      } catch (e) {
        console.warn('Screen share cancelled:', e);
      }
    }

    async sendData(message) {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        this.dataChannel.send(message);
      }
    }

    endCall() {
      if (this.pc) {
        this.pc.close();
        this.pc = null;
      }
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => t.stop());
        this.localStream = null;
      }
      this.remoteStream = null;
      this.dataChannel = null;
      this.activeCall = { status: 'ended' };
      this._emit('call:status', this.activeCall);
      this.activeCall = null;
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

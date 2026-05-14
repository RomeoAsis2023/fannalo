(function () {
  window.FannaloAuth = class FannaloAuth {
    constructor(db, p2p) {
      this.db = db;
      this.p2p = p2p;
      this.currentUser = null;
      this.sessionId = localStorage.getItem('fannalo_session');
      this.authenticated = !!this.sessionId;
      this.listeners = {};
      this.tokens = new Map();
    }

    async init() {
      if (this.sessionId) {
        const session = await this._getSession(this.sessionId);
        if (session && session.expires > Date.now()) {
          this.currentUser = await this.db.getUser(session.userId);
          if (this.currentUser) {
            this.authenticated = true;
            await this.db.setUserId(session.userId);
            this._emit('auth:ready', this.currentUser);
          }
        } else {
          this.logout();
        }
      }
      return this;
    }

    async register(data) {
      const existing = await this.db.getUserByUsername(data.username);
      if (existing) throw new Error('Username already taken');

      let passkeyCredential = null;
      if (data.usePasskey && window.PublicKeyCredential) {
        try {
          passkeyCredential = await this._createPasskey(data.username);
        } catch (e) {
          console.warn('Passkey creation skipped:', e);
        }
      }

      const passwordHash = data.password ? await this._hash(data.password) : '';
      const user = await this.db.createUser({
        username: data.username,
        displayName: data.displayName || data.username,
        email: data.email || '',
        bio: data.bio || '',
        securityQuestion: data.securityQuestion || '',
        securityAnswer: data.securityAnswer || '',
        pubKey: passkeyCredential ? this._arrayBufferToBase64(passkeyCredential.rawId) : '',
        isCreator: data.isCreator || false,
        subscriptionPrice: data.subscriptionPrice || 0,
        passwordHash
      });

      await this.db.setUserId(user.id);
      const session = await this._createSession(user.id);
      this.currentUser = user;
      this.authenticated = true;
      this.sessionId = session.id;
      localStorage.setItem('fannalo_session', session.id);
      this._emit('auth:login', user);

      if (this.p2p && this.p2p.broadcast) {
        this.p2p.broadcast({
          type: 'user:status',
          userId: user.id,
          username: user.username,
          status: 'online',
          timestamp: Date.now()
        });
      }

      return user;
    }

    async login(username, password) {
      const user = await this.db.getUserByUsername(username);
      if (!user) throw new Error('User not found');

      if (user.passwordHash) {
        const hash = await this._hash(password);
        if (hash !== user.passwordHash) throw new Error('Invalid password');
      } else {
        throw new Error('No password set for this account');
      }

      await this.db.setUserId(user.id);
      const session = await this._createSession(user.id);
      this.currentUser = user;
      this.authenticated = true;
      this.sessionId = session.id;
      localStorage.setItem('fannalo_session', session.id);
      this._emit('auth:login', user);

      if (this.p2p && this.p2p.broadcast) {
        this.p2p.broadcast({
          type: 'user:status',
          userId: user.id,
          username: user.username,
          status: 'online',
          timestamp: Date.now()
        });
      }

      return user;
    }

    async loginWithPasskey() {
      if (!window.PublicKeyCredential) throw new Error('WebAuthn not supported');
      try {
        const credential = await navigator.credentials.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: window.location.hostname,
            allowCredentials: [],
            userVerification: 'required'
          }
        });
        const users = await this.db.map({ query: { type: 'user' } });
        const rawId = this._arrayBufferToBase64(credential.rawId);
        const user = users.find(u => u.pubKey === rawId);
        if (!user) throw new Error('No account linked to this passkey');

        await this.db.setUserId(user.id);
        const session = await this._createSession(user.id);
        this.currentUser = user;
        this.authenticated = true;
        this.sessionId = session.id;
        localStorage.setItem('fannalo_session', session.id);
        this._emit('auth:login', user);
        return user;
      } catch (e) {
        throw new Error('Passkey authentication failed: ' + e.message);
      }
    }

    async logout() {
      if (this.sessionId) {
        await this.db.remove(this.sessionId);
      }
      if (this.p2p && this.p2p.broadcast && this.currentUser) {
        this.p2p.broadcast({
          type: 'user:status',
          userId: this.currentUser.id,
          status: 'offline',
          timestamp: Date.now()
        });
      }
      this.currentUser = null;
      this.authenticated = false;
      this.sessionId = null;
      localStorage.removeItem('fannalo_session');
      localStorage.removeItem('fannalo_user_id');
      this._emit('auth:logout');
    }

    async verifySecurityQuestion(username, answer) {
      const user = await this.db.getUserByUsername(username);
      if (!user || !user.securityAnswer) return false;
      const hash = await this._hash(answer.toLowerCase().trim());
      return hash === user.securityAnswer;
    }

    async generateOTP(userId) {
      const secret = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
      await this.db.put({
        type: 'otp',
        userId,
        secret,
        expires: Date.now() + 300000,
        used: false,
        createdAt: Date.now()
      });
      const otp = this._generateTOTP(secret);
      await this.db.createNotification({
        userId,
        kind: 'otp',
        message: `Your OTP is: ${otp}. Expires in 5 minutes.`
      });
      return otp;
    }

    async verifyOTP(userId, code) {
      const otps = await this.db.map({ query: { type: 'otp', userId, used: false } });
      for (const otp of otps) {
        if (otp.expires < Date.now()) continue;
        const expected = this._generateTOTP(otp.secret);
        if (code === expected) {
          otp.used = true;
          await this.db.put(otp);
          return true;
        }
      }
      return false;
    }

    async resetPassword(username, newPassword) {
      const user = await this.db.getUserByUsername(username);
      if (!user) throw new Error('User not found');
      user.passwordHash = await this._hash(newPassword);
      await this.db.updateUser(user.id, { passwordHash: user.passwordHash });
      return true;
    }

    requireAuth() {
      if (!this.authenticated) {
        window.location.href = 'login.html';
        return false;
      }
      return true;
    }

    async _createPasskey(username) {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'Fannalo', id: window.location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: username,
            displayName: username
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'required'
          },
          timeout: 60000
        }
      });
      return credential;
    }

    async _createSession(userId) {
      const session = {
        type: 'session',
        userId,
        createdAt: Date.now(),
        expires: Date.now() + 86400000 * 7,
        lastActivity: Date.now()
      };
      const id = await this.db.put(session);
      return { ...session, id };
    }

    async _getSession(sessionId) {
      return await this.db.get(sessionId);
    }

    async _hash(str) {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    _generateTOTP(secret) {
      const time = Math.floor(Date.now() / 30000);
      const hash = this._simpleHash(secret + time);
      return (hash % 1000000).toString().padStart(6, '0');
    }

    _simpleHash(str) {
      let h = 0;
      for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
      }
      return Math.abs(h);
    }

    _arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
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
  };
})();

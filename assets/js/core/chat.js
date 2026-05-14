(function () {
  window.FannaloChat = class FannaloChat {
    constructor(db, p2p, auth) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
      this.conversations = new Map();
      this.activeChat = null;
      this.listeners = {};
    }

    async init() {
      if (!this.p2p) return;
      this.p2p.on('chat', (msg) => this._handleIncoming(msg));
      const convos = await this.db.map({ query: { type: 'conversation', participants: this.auth.currentUser?.id } });
      convos.forEach(c => this.conversations.set(c.id, c));
    }

    async getOrCreateConversation(otherUserId) {
      const existing = Array.from(this.conversations.values()).find(c =>
        c.participants && c.participants.includes(this.auth.currentUser.id) && c.participants.includes(otherUserId)
      );
      if (existing) return existing;

      const conv = {
        type: 'conversation',
        participants: [this.auth.currentUser.id, otherUserId],
        lastMessage: null,
        lastActivity: Date.now(),
        unread: { [this.auth.currentUser.id]: 0, [otherUserId]: 0 },
        createdAt: Date.now()
      };
      const id = await this.db.put(conv);
      conv.id = id;
      this.conversations.set(id, conv);
      return conv;
    }

    async getConversations() {
      const userId = this.auth.currentUser.id;
      const convos = await this.db.map({ query: { type: 'conversation' } });
      const mine = convos.filter(c => c.participants && c.participants.includes(userId));
      const enriched = await Promise.all(mine.map(async c => {
        const otherId = c.participants.find(p => p !== userId);
        const other = await this.db.getUser(otherId);
        const messages = await this.getMessages(c.id);
        return { ...c, other: other || { displayName: 'Unknown', username: 'unknown' }, messages };
      }));
      enriched.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
      return enriched;
    }

    async getMessages(conversationId, limit = 50) {
      const msgs = await this.db.map({ query: { type: 'message', conversationId } });
      return msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(-limit);
    }

    async sendMessage(conversationId, text) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      const msg = {
        type: 'message',
        conversationId,
        senderId: this.auth.currentUser.id,
        text,
        timestamp: Date.now(),
        read: false
      };
      const id = await this.db.put(msg);
      msg.id = id;

      const conv = await this.db.get(conversationId);
      if (conv) {
        conv.lastMessage = text;
        conv.lastActivity = Date.now();
        const otherId = conv.participants.find(p => p !== this.auth.currentUser.id);
        if (otherId) {
          conv.unread = conv.unread || {};
          conv.unread[otherId] = (conv.unread[otherId] || 0) + 1;
        }
        await this.db.put(conv);
      }

      const otherId = conv?.participants.find(p => p !== this.auth.currentUser.id);
      if (otherId && this.p2p) {
        this.p2p.sendChat(otherId, { conversationId, text, msgId: id });
      }

      return msg;
    }

    async markRead(conversationId) {
      const conv = await this.db.get(conversationId);
      if (!conv) return;
      conv.unread = conv.unread || {};
      conv.unread[this.auth.currentUser.id] = 0;
      await this.db.put(conv);

      const msgs = await this.db.map({ query: { type: 'message', conversationId, read: false } });
      for (const msg of msgs) {
        if (msg.senderId !== this.auth.currentUser.id) {
          msg.read = true;
          await this.db.put(msg);
        }
      }
    }

    _handleIncoming(data) {
      const { conversationId, text, msgId, from } = data;
      this._emit('message', {
        conversationId,
        text,
        senderId: data.from,
        msgId,
        timestamp: Date.now()
      });
    }

    async getUnreadCount() {
      const userId = this.auth.currentUser.id;
      const convos = await this.db.map({ query: { type: 'conversation' } });
      let total = 0;
      for (const c of convos) {
        if (c.participants && c.participants.includes(userId)) {
          total += (c.unread && c.unread[userId]) || 0;
        }
      }
      return total;
    }

    renderConversation(conv) {
      const div = document.createElement('div');
      const otherId = conv.participants.find(p => p !== this.auth.currentUser.id);
      const unread = (conv.unread && conv.unread[this.auth.currentUser.id]) || 0;
      div.className = `card ${unread > 0 ? '' : ''}`;
      div.style.cssText = `padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px;${unread > 0 ? 'border-left:3px solid var(--accent);' : ''}`;
      div.innerHTML = `
        <div class="avatar avatar-md" style="background:${this._getColor(conv.other?.username || '')};flex-shrink:0;">
          ${(conv.other?.displayName || '?')[0]}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:${unread > 0 ? '700' : '500'};font-size:14px;">${conv.other?.displayName || 'Unknown'}</span>
            <span style="font-size:11px;color:var(--text-muted);">${this._timeAgo(conv.lastActivity)}</span>
          </div>
          <div style="font-size:13px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">
            ${conv.lastMessage || 'No messages yet'}
          </div>
        </div>
        ${unread > 0 ? `<div style="background:var(--accent);color:#000;font-size:11px;font-weight:700;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${unread}</div>` : ''}
      `;
      return div;
    }

    renderMessage(msg, isOwn) {
      const div = document.createElement('div');
      div.style.cssText = `display:flex;${isOwn ? 'justify-content:flex-end' : 'justify-content:flex-start'};margin-bottom:8px;`;
      div.innerHTML = `
        <div style="max-width:75%;padding:10px 16px;border-radius:${isOwn ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};background:${isOwn ? 'var(--accent)' : 'var(--bg-card)'};color:${isOwn ? '#000' : 'var(--text-primary)'};font-size:14px;line-height:1.5;word-wrap:break-word;">
          ${msg.text}
          <div style="font-size:10px;color:${isOwn ? 'rgba(0,0,0,0.5)' : 'var(--text-muted)'};margin-top:4px;text-align:${isOwn ? 'right' : 'left'};">
            ${this._timeAgo(msg.timestamp)}
            ${isOwn ? (msg.read ? ' ✓✓' : ' ✓') : ''}
          </div>
        </div>
      `;
      return div;
    }

    _getColor(username) {
      const colors = ['#00d4ff','#7c3aed','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#8b5cf6'];
      let h = 0;
      for (let i = 0; i < (username || '').length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
      return colors[Math.abs(h) % colors.length];
    }

    _timeAgo(t) {
      if (!t) return '';
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return 'now';
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      return `${d}d`;
    }

    on(event, cb) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
    }

    _emit(event, data) {
      (this.listeners[event] || []).forEach(cb => cb(data));
    }
  };
})();

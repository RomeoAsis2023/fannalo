(function () {
  window.FannaloNotifications = class FannaloNotifications {
    constructor(db, p2p) {
      this.db = db;
      this.p2p = p2p;
      this.notifications = [];
      this.unreadCount = 0;
      this.listeners = {};
    }

    async load(userId) {
      this.notifications = await this.db.getNotifications(userId);
      this.unreadCount = this.notifications.filter(n => !n.read).length;
      return this.notifications;
    }

    async markRead(notificationId) {
      const notif = await this.db.get(notificationId);
      if (notif) {
        notif.read = true;
        await this.db.put(notif);
        this.unreadCount = Math.max(0, this.unreadCount - 1);
      }
    }

    async markAllRead(userId) {
      for (const n of this.notifications) {
        if (!n.read) {
          n.read = true;
          await this.db.put(n);
        }
      }
      this.unreadCount = 0;
    }

    async create(kind, message, userId, fromId = null) {
      const notif = await this.db.createNotification({ userId, fromId, kind, message });

      if (this.p2p && this.p2p.send) {
        this.p2p.sendNotification(userId, {
          id: notif.id,
          kind,
          message,
          fromId
        });
      }

      return notif;
    }

    listenForRealtime(userId) {
      if (!this.p2p) return;
      this._unsubscribe = this.p2p.on('notification', (data) => {
        if (data.userId === userId || !data.userId) {
          this.load(userId);
          this._emit('new', data);
          this._showToast(data);
        }
      });
    }

    stopListening() {
      if (this._unsubscribe) this._unsubscribe();
    }

    _showToast(data) {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast info';
      toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;width:100%;">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;">${data.kind || 'Notification'}</div>
            <div style="font-size:12px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${data.message || ''}</div>
          </div>
          <button onclick="this.closest('.toast').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer;">&times;</button>
        </div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }

    render(notifications) {
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

      if (!notifications || notifications.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔔</div>
            <h3 style="color:var(--text-secondary);margin-bottom:8px;">No notifications</h3>
            <p style="color:var(--text-muted);font-size:14px;">You'll see notifications here when someone interacts with you.</p>
          </div>
        `;
        return list;
      }

      notifications.forEach(n => {
        const item = document.createElement('div');
        item.className = 'card';
        item.style.cssText = `padding:16px;cursor:pointer;display:flex;align-items:flex-start;gap:12px;${n.read ? '' : 'border-left:3px solid var(--accent);'}`;
        item.onclick = () => this.markRead(n.id);

        const icons = {
          like: '❤️',
          comment: '💬',
          follow: '👤',
          subscribe: '⭐',
          credit_received: '💰',
          tip: '💎',
          system: '🔔',
          otp: '🔐',
          friend_request: '🤝'
        };

        item.innerHTML = `
          <div style="font-size:20px;flex-shrink:0;">${icons[n.kind] || '📌'}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;color:var(--text-primary);${n.read ? '' : 'font-weight:600;'}">${n.message}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${this._timeAgo(n.createdAt)}</div>
          </div>
          ${n.read ? '' : '<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:4px;"></div>'}
        `;

        list.appendChild(item);
      });

      return list;
    }

    _timeAgo(timestamp) {
      if (!timestamp) return '';
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 60) return 'just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      if (days < 7) return `${days}d ago`;
      return new Date(timestamp).toLocaleDateString();
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

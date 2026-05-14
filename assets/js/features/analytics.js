(function () {
  window.FannaloAnalytics = class FannaloAnalytics {
    constructor(db, p2p, auth) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
      this.realtime = {
        peers: 0,
        activeViewers: 0,
        postsPerMinute: 0,
        activeUsers: new Set(),
        startTime: Date.now()
      };
      this.interval = null;
    }

    startRealtime() {
      if (this.interval) return;
      this.interval = setInterval(() => this._sample(), 10000);
      if (this.p2p) {
        this.p2p.on('user:status', (msg) => {
          if (msg.status === 'online') {
            this.realtime.activeUsers.add(msg.userId);
          } else {
            this.realtime.activeUsers.delete(msg.userId);
          }
        });
      }
    }

    stopRealtime() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
    }

    _sample() {
      if (this.p2p) {
        this.realtime.peers = this.p2p.getPeerCount();
      }
      this._emit('update', this.getRealtimeStats());
    }

    async getDashboard(userId) {
      const posts = await this.db.map({ query: { type: 'post' } });
      const users = await this.db.map({ query: { type: 'user' } });
      const transactions = await this.db.map({ query: { type: 'transaction' } });
      const subscriptions = await this.db.map({ query: { type: 'subscription', active: true } });
      const events = await this.db.map({ query: { type: 'event' } });
      const liveStreams = await this.db.map({ query: { type: 'live', active: true } });

      const now = Date.now();
      const day24h = now - 86400000;
      const week7d = now - 604800000;

      const recentPosts = posts.filter(p => p.createdAt > day24h).length;
      const newUsers24h = users.filter(u => u.createdAt > day24h).length;
      const revenue24h = transactions
        .filter(t => t.kind === 'credit' && t.createdAt > day24h)
        .reduce((s, t) => s + (t.amount || 0), 0);

      const postsByDay = this._groupByDay(posts);
      const usersByDay = this._groupByDay(users);
      const revenueByDay = this._groupByDay(transactions.filter(t => t.kind === 'credit'));

      const popularPosts = posts
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 5);

      const topCreators = users
        .filter(u => u.isCreator)
        .sort((a, b) => (b.earnings || 0) - (a.earnings || 0))
        .slice(0, 5);

      const userGrowth = this._calculateGrowth(usersByDay);
      const postGrowth = this._calculateGrowth(postsByDay);

      return {
        overview: {
          totalUsers: users.length,
          totalPosts: posts.length,
          totalTransactions: transactions.length,
          activeSubscriptions: subscriptions.length,
          activeLiveStreams: liveStreams.length,
          totalEvents: events.length
        },
        realtime: this.getRealtimeStats(),
        trends: {
          recentPosts,
          newUsers24h,
          revenue24h,
          userGrowth,
          postGrowth
        },
        charts: {
          postsByDay,
          usersByDay,
          revenueByDay
        },
        topContent: popularPosts,
        topCreators
      };
    }

    getRealtimeStats() {
      return {
        peers: this.realtime.peers,
        activeUsers: this.realtime.activeUsers.size,
        uptime: Math.floor((Date.now() - this.realtime.startTime) / 1000)
      };
    }

    async getPeerAnalytics() {
      const superPeers = await this.db.map({ query: { type: 'user', isSuperPeer: true } });
      return {
        totalPeers: this.realtime.peers,
        superPeers: superPeers.length,
        activeUsers: this.realtime.activeUsers.size,
        p2pConnections: this.p2p?.getPeerCount() || 0
      };
    }

    _groupByDay(items) {
      const groups = {};
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const key = d.toLocaleDateString('en-US', { weekday: 'short' });
        groups[key] = 0;
      }
      items.forEach(item => {
        if (!item.createdAt) return;
        const d = new Date(item.createdAt);
        const key = d.toLocaleDateString('en-US', { weekday: 'short' });
        if (groups[key] !== undefined) groups[key]++;
      });
      return Object.entries(groups).map(([day, count]) => ({ day, count }));
    }

    _calculateGrowth(byDay) {
      const vals = Object.values(byDay);
      if (vals.length < 2) return 0;
      const recent = vals.slice(-3).reduce((s, v) => s + v.count, 0);
      const prev = vals.slice(0, -3).reduce((s, v) => s + v.count, 0);
      if (prev === 0) return 100;
      return Math.round(((recent - prev) / prev) * 100);
    }

    renderChart(data, labelKey, valueKey, color = 'var(--accent)') {
      if (!data || data.length === 0) return '<div style="color:var(--text-muted);font-size:13px;">No data</div>';
      const max = Math.max(...data.map(d => d[valueKey]), 1);
      const bars = data.map(d => {
        const pct = (d[valueKey] / max) * 100;
        return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <div style="width:40px;font-size:11px;color:var(--text-muted);text-align:right;">${d[labelKey]}</div>
            <div style="flex:1;height:20px;background:var(--bg-secondary);border-radius:4px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width 0.6s ease;"></div>
            </div>
            <div style="width:30px;font-size:11px;color:var(--text-secondary);">${d[valueKey]}</div>
          </div>
        `;
      }).join('');
      return `<div style="padding:8px 0;">${bars}</div>`;
    }

    on(event, cb) {
      if (!this.listeners) this.listeners = {};
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(cb);
    }

    _emit(event, data) {
      (this.listeners?.[event] || []).forEach(cb => cb(data));
    }
  };
})();

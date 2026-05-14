(function () {
  window.FannaloAdmin = class FannaloAdmin {
    constructor(db, p2p) {
      this.db = db;
      this.p2p = p2p;
    }

    async getDashboardStats() {
      const users = await this.db.map({ query: { type: 'user' } });
      const posts = await this.db.map({ query: { type: 'post' } });
      const transactions = await this.db.map({ query: { type: 'transaction' } });
      const subscriptions = await this.db.map({ query: { type: 'subscription', active: true } });

      const totalCredits = transactions
        .filter(t => t.kind === 'credit' && t.status === 'completed')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const totalEarnings = users.reduce((sum, u) => sum + (u.earnings || 0), 0);

      const creators = users.filter(u => u.isCreator);
      const superPeers = users.filter(u => u.isSuperPeer);
      const onlinePeers = this.p2p ? this.p2p.getPeerCount() : 0;

      const recentUsers = users
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 10);

      const recentPosts = posts
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 10);

      return {
        total: {
          users: users.length,
          posts: posts.length,
          transactions: transactions.length,
          subscriptions: subscriptions.length
        },
        financial: {
          totalCredits,
          totalEarnings,
          avgEarnings: creators.length ? (totalEarnings / creators.length) : 0
        },
        network: {
          creators: creators.length,
          superPeers: superPeers.length,
          onlinePeers
        },
        recentUsers,
        recentPosts
      };
    }

    async getAllUsers() {
      const users = await this.db.map({ query: { type: 'user' } });
      return users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async banUser(userId) {
      const user = await this.db.getUser(userId);
      if (!user) return false;
      user.role = 'banned';
      user.bannedAt = Date.now();
      await this.db.put(user);

      if (this.p2p && this.p2p.broadcast) {
        this.p2p.broadcast({
          type: 'admin:user_banned',
          userId,
          timestamp: Date.now()
        });
      }
      return true;
    }

    async unbanUser(userId) {
      const user = await this.db.getUser(userId);
      if (!user) return false;
      user.role = 'user';
      delete user.bannedAt;
      await this.db.put(user);
      return true;
    }

    async verifyCreator(userId) {
      const user = await this.db.getUser(userId);
      if (!user) return false;
      user.isCreator = true;
      user.verifiedAt = Date.now();
      await this.db.put(user);
      return true;
    }

    async removePost(postId) {
      const post = await this.db.get(postId);
      if (!post) return false;
      post.removed = true;
      post.removedAt = Date.now();
      await this.db.put(post);
      return true;
    }

    async getModerationQueue() {
      const posts = await this.db.map({ query: { type: 'post' } });
      return posts
        .filter(p => p.removed || (p.reports && p.reports.length > 0))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    renderStatsTable(stats) {
      return {
        total: [
          { label: 'Total Users', value: stats.total.users, icon: '👤' },
          { label: 'Total Posts', value: stats.total.posts, icon: '📝' },
          { label: 'Transactions', value: stats.total.transactions, icon: '💳' },
          { label: 'Active Subs', value: stats.total.subscriptions, icon: '⭐' }
        ],
        financial: [
          { label: 'Total Credits', value: this._formatCredits(stats.financial.totalCredits), icon: '💰' },
          { label: 'Total Earnings', value: this._formatCredits(stats.financial.totalEarnings), icon: '📈' },
          { label: 'Avg Earnings/Creator', value: this._formatCredits(stats.financial.avgEarnings), icon: '📊' }
        ],
        network: [
          { label: 'Creators', value: stats.network.creators, icon: '🎨' },
          { label: 'Super Peers', value: stats.network.superPeers, icon: '⚡' },
          { label: 'Online Peers', value: stats.network.onlinePeers, icon: '🌐' }
        ]
      };
    }

    _formatCredits(amount) {
      if (!amount || isNaN(amount)) return '$0';
      if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
      if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'K';
      return '$' + Number(amount).toFixed(2);
    }
  };
})();

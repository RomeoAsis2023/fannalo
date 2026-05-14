(function () {
  window.FannaloEarnings = class FannaloEarnings {
    constructor(db, auth) {
      this.db = db;
      this.auth = auth;
    }

    async getDashboard(userId) {
      const user = await this.db.getUser(userId);
      const transactions = await this.db.map({ query: { type: 'transaction', userId } });
      const subscriptions = await this.db.getSubscribers(userId);
      const posts = await this.db.map({ query: { type: 'post', authorId: userId } });

      const creditTxs = transactions.filter(t => t.kind === 'credit');
      const debitTxs = transactions.filter(t => t.kind === 'debit');
      const subscriptionsEarned = creditTxs.filter(t => t.description && t.description.includes('Subscription'));

      const totalEarnings = creditTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
      const totalSpent = Math.abs(debitTxs.reduce((sum, t) => sum + (t.amount || 0), 0));
      const subsEarned = subscriptionsEarned.reduce((sum, t) => sum + (t.amount || 0), 0);
      const balance = user?.credits || 0;

      const monthlyEarnings = this._groupByMonth(creditTxs);
      const recentTxs = creditTxs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 20);

      const postEngagement = posts.reduce((acc, p) => ({
        likes: acc.likes + (p.likes || 0),
        comments: acc.comments + (p.comments || 0),
        total: acc.total + 1
      }), { likes: 0, comments: 0, total: 0 });

      return {
        balance,
        totalEarnings,
        totalSpent,
        subsEarned,
        subscriberCount: subscriptions.length,
        postCount: posts.length,
        monthlyEarnings,
        recentTransactions: recentTxs,
        postEngagement,
        user
      };
    }

    async getWithdrawalHistory(userId) {
      return await this.db.map({ query: { type: 'withdrawal', userId } });
    }

    async requestWithdrawal(userId, amount, method = 'paypal') {
      const user = await this.db.getUser(userId);
      if (!user || (user.credits || 0) < amount) throw new Error('Insufficient credits');
      if (amount < 10) throw new Error('Minimum withdrawal is 10 credits');
      if (method === 'paypal' && !user.paypalEmail) throw new Error('Set your PayPal email first');

      user.credits -= amount;
      await this.db.put(user);

      const withdrawal = {
        type: 'withdrawal',
        userId,
        amount,
        method,
        status: 'pending',
        createdAt: Date.now()
      };
      const id = await this.db.put(withdrawal);

      await this.db.put({
        type: 'transaction',
        userId,
        amount: -amount,
        kind: 'debit',
        description: `Withdrawal (${method})`,
        status: 'pending',
        createdAt: Date.now()
      });

      return { ...withdrawal, id };
    }

    renderStatCard(label, value, icon, change = null) {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <div style="font-size:24px;margin-bottom:8px;">${icon}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
        ${change !== null ? `<div style="font-size:12px;margin-top:6px;color:${change >= 0 ? 'var(--success)' : 'var(--danger)'};">${change >= 0 ? '↑' : '↓'} ${Math.abs(change)}%</div>` : ''}
      `;
      return card;
    }

    _groupByMonth(transactions) {
      const groups = {};
      transactions.forEach(t => {
        if (!t.createdAt) return;
        const d = new Date(t.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        groups[key] = (groups[key] || 0) + (t.amount || 0);
      });
      return Object.entries(groups).sort().slice(-12).map(([month, amount]) => ({ month, amount }));
    }

    _formatCredits(amount) {
      if (!amount || isNaN(amount)) return '$0.00';
      if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(2) + 'M';
      if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'K';
      return '$' + Number(amount).toFixed(2);
    }
  };
})();

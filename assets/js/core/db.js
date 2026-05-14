(function () {
  window.FannaloDB = class FannaloDB {
    constructor() {
      this.db = null;
      this.ready = false;
      this.peers = new Map();
      this.userId = localStorage.getItem('fannalo_user_id');
      this.listeners = {};
    }

async init() {
        // Force fallback DB – external GenosDB CDN is unavailable in this environment
        this._initFallback();
        this.ready = true;
        return this;
      }

    _initFallback() {
      this.db = {
        _store: JSON.parse(localStorage.getItem('fannalo_fallback') || '{}'),
        async put(node) {
          const id = node.id || crypto.randomUUID();
          this._store[id] = { ...node, id, _updated: Date.now() };
          localStorage.setItem('fannalo_fallback', JSON.stringify(this._store));
          return id;
        },
        async get(id) { return this._store[id] || null; },
        async remove(id) { delete this._store[id]; localStorage.setItem('fannalo_fallback', JSON.stringify(this._store)); },
        async map(opts, cb) {
          const results = Object.values(this._store).filter(n => {
            if (!opts.query) return true;
            return Object.entries(opts.query).every(([k, v]) => n[k] === v);
          });
          if (cb) results.forEach(r => cb(r));
          return results;
        },
        async link(src, tgt, label) {
          const link = { id: crypto.randomUUID(), source: src, target: tgt, label, _updated: Date.now() };
          this._store[link.id] = link;
          localStorage.setItem('fannalo_fallback', JSON.stringify(this._store));
          return link;
        }
      };
      this.ready = true;
    }

    _setupSync() {
      if (this.db && this.db.room) {
        this.db.room.onPeerJoin = (peer) => {
          this.peers.set(peer.id, peer);
          this._emit('peer:join', peer);
        };
        this.db.room.onPeerLeave = (peer) => {
          this.peers.delete(peer.id);
          this._emit('peer:leave', peer);
        };
        this.db.room.onSync = (data) => {
          this._emit('sync', data);
        };
      }
    }

    async createUser(data) {
      const user = {
        type: 'user',
        username: data.username,
        displayName: data.displayName,
        bio: data.bio || '',
        avatar: data.avatar || '',
        coverPhoto: data.coverPhoto || '',
        email: data.email || '',
        securityQuestion: data.securityQuestion || '',
        securityAnswer: data.securityAnswer ? await this._hash(data.securityAnswer) : '',
        pubKey: data.pubKey || '',
        role: data.role || 'user',
        isCreator: data.isCreator || false,
        subscriptionPrice: data.subscriptionPrice || 0,
        isSuperPeer: false,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        followers: 0,
        following: 0,
        earnings: 0,
        credits: 0
      };
      const id = await this.db.put(user);
      return { ...user, id };
    }

    async getUser(userId) {
      return await this.db.get(userId);
    }

    async getUserByUsername(username) {
      const users = await this.db.map({ query: { type: 'user', username } });
      return users.length ? users[0] : null;
    }

    async updateUser(userId, updates) {
      const user = await this.db.get(userId);
      if (!user) return null;
      const updated = { ...user, ...updates, _updated: Date.now() };
      await this.db.put(updated);
      return updated;
    }

    async createPost(data) {
      const post = {
        type: 'post',
        authorId: data.authorId,
        content: data.content || '',
        media: data.media || [],
        mediaType: data.mediaType || 'text',
        tags: data.tags || [],
        isPremium: data.isPremium || false,
        premiumPrice: data.premiumPrice || 0,
        createdAt: Date.now(),
        likes: 0,
        comments: 0,
        shares: 0,
        likedBy: []
      };
      const id = await this.db.put(post);
      await this.db.link(data.authorId, id, 'authored');
      return { ...post, id };
    }

    async getFeed(userId, limit = 20) {
      const allPosts = await this.db.map({ query: { type: 'post' } });
      const subscriptions = await this.getSubscriptions(userId);
      const subIds = new Set(subscriptions.map(s => s.targetId));
      subIds.add(userId);

      const feed = allPosts
        .filter(p => subIds.has(p.authorId))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, limit);

      const enriched = await Promise.all(feed.map(async p => {
        const author = await this.db.get(p.authorId);
        return { ...p, author: author || { username: 'unknown', displayName: 'Unknown' } };
      }));
      return enriched;
    }

    async likePost(postId, userId) {
      const post = await this.db.get(postId);
      if (!post) return false;
      if (!post.likedBy) post.likedBy = [];
      if (post.likedBy.includes(userId)) return false;
      post.likedBy.push(userId);
      post.likes = post.likedBy.length;
      await this.db.put(post);
      return true;
    }

    async unlikePost(postId, userId) {
      const post = await this.db.get(postId);
      if (!post) return false;
      if (!post.likedBy) return false;
      post.likedBy = post.likedBy.filter(id => id !== userId);
      post.likes = post.likedBy.length;
      await this.db.put(post);
      return true;
    }

    async follow(followerId, targetId) {
      const link = await this.db.link(followerId, targetId, 'follows');
      const target = await this.db.get(targetId);
      if (target) {
        target.followers = (target.followers || 0) + 1;
        await this.db.put(target);
      }
      const follower = await this.db.get(followerId);
      if (follower) {
        follower.following = (follower.following || 0) + 1;
        await this.db.put(follower);
      }
      return link;
    }

    async subscribe(followerId, targetId, tier = 'monthly') {
      const link = await this.db.link(followerId, targetId, 'subscribes');
      const sub = {
        id: link.id,
        subscriberId: followerId,
        creatorId: targetId,
        tier,
        active: true,
        startDate: Date.now(),
        nextBilling: Date.now() + (tier === 'yearly' ? 365 : 30) * 86400000
      };
      await this.db.put({ ...sub, type: 'subscription' });
      return sub;
    }

    async getSubscriptions(userId) {
      return await this.db.map({ query: { type: 'subscription', subscriberId: userId, active: true } });
    }

    async getSubscribers(userId) {
      return await this.db.map({ query: { type: 'subscription', creatorId: userId, active: true } });
    }

    async addFriend(userId, friendId) {
      const existing = await this.db.map({ query: { type: 'friendRequest', from: userId, to: friendId } });
      if (existing.length) return existing[0];
      return await this.db.put({
        type: 'friendRequest',
        from: userId,
        to: friendId,
        status: 'pending',
        createdAt: Date.now()
      });
    }

    async acceptFriend(requestId) {
      const req = await this.db.get(requestId);
      if (!req) return false;
      req.status = 'accepted';
      await this.db.put(req);
      await this.db.link(req.from, req.to, 'friend');
      await this.db.link(req.to, req.from, 'friend');
      return true;
    }

    async getFriends(userId) {
      const links = await this.db.map({
        query: { type: 'friend', source: userId }
      });
      const friends = await Promise.all(
        links.map(l => this.db.get(l.target))
      );
      return friends.filter(Boolean);
    }

    async addCredits(userId, amount, method = 'paypal') {
      const user = await this.db.get(userId);
      if (!user) return false;
      user.credits = (user.credits || 0) + amount;
      await this.db.put(user);
      await this.db.put({
        type: 'transaction',
        userId,
        amount,
        method,
        kind: 'credit',
        status: 'completed',
        createdAt: Date.now()
      });
      return true;
    }

    async spendCredits(userId, amount, description = '') {
      const user = await this.db.get(userId);
      if (!user || (user.credits || 0) < amount) return false;
      user.credits -= amount;
      await this.db.put(user);
      await this.db.put({
        type: 'transaction',
        userId,
        amount: -amount,
        kind: 'debit',
        description,
        status: 'completed',
        createdAt: Date.now()
      });
      return true;
    }

    async getTransactions(userId) {
      return await this.db.map({ query: { type: 'transaction', userId } });
    }

    async createNotification(data) {
      return await this.db.put({
        type: 'notification',
        userId: data.userId,
        fromId: data.fromId,
        kind: data.kind,
        message: data.message,
        read: false,
        createdAt: Date.now()
      });
    }

    async getNotifications(userId) {
      const notifs = await this.db.map({ query: { type: 'notification', userId } });
      return notifs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async addTip(fromUserId, toUserId, postId, amount) {
      const from = await this.getUser(fromUserId);
      if (!from || (from.credits || 0) < amount) return false;
      from.credits -= amount;
      await this.put(from);
      const to = await this.getUser(toUserId);
      if (to) { to.earnings = (to.earnings || 0) + amount; to.credits = (to.credits || 0) + amount; await this.put(to); }
      const tip = { type: 'tip', fromUserId, toUserId, postId, amount, createdAt: Date.now() };
      const id = await this.db.put(tip);
      await this.db.put({ type: 'transaction', userId: fromUserId, amount: -amount, kind: 'debit', description: `Tip to ${toUserId}`, status: 'completed', createdAt: Date.now() });
      await this.db.put({ type: 'transaction', userId: toUserId, amount, kind: 'credit', description: `Tip from ${fromUserId}`, status: 'completed', createdAt: Date.now() });
      return { ...tip, id };
    }

    async subscribeTiered(followerId, targetId, tier = 'basic') {
      const tiers = { basic: 5, premium: 15, vip: 50 };
      const price = tiers[tier] || 5;
      const user = await this.getUser(followerId);
      if (!user || (user.credits || 0) < price) return false;
      user.credits -= price;
      await this.put(user);
      const sub = { type: 'subscription', subscriberId: followerId, creatorId: targetId, tier, active: true, price, startDate: Date.now(), nextBilling: Date.now() + 30 * 86400000 };
      const id = await this.db.put(sub);
      const creator = await this.getUser(targetId);
      if (creator) { creator.earnings = (creator.earnings || 0) + price; await this.put(creator); }
      return { ...sub, id };
    }

    async createPoll(data) {
      const poll = { type: 'poll', postId: data.postId, question: data.question, options: data.options.map(o => ({ text: o, votes: 0, voters: [] })), totalVotes: 0, expiresAt: Date.now() + (data.duration || 86400000), createdAt: Date.now() };
      const id = await this.db.put(poll);
      return { ...poll, id };
    }

    async votePoll(pollId, optionIndex, userId) {
      const poll = await this.db.get(pollId);
      if (!poll || poll.expiresAt < Date.now()) return false;
      if (poll.options.some(o => o.voters.includes(userId))) return false;
      poll.options[optionIndex].votes++;
      poll.options[optionIndex].voters.push(userId);
      poll.totalVotes++;
      await this.db.put(poll);
      return true;
    }

    async createStory(data) {
      const story = { type: 'story', authorId: data.authorId, media: data.media || [], mediaType: data.mediaType || 'image', text: data.text || '', expiresAt: Date.now() + 86400000, views: [], createdAt: Date.now() };
      const id = await this.db.put(story);
      return { ...story, id };
    }

    async getActiveStories() {
      const stories = await this.db.map({ query: { type: 'story' } });
      return stories.filter(s => s.expiresAt > Date.now()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async viewStory(storyId, userId) {
      const story = await this.db.get(storyId);
      if (!story || story.views.includes(userId)) return;
      story.views.push(userId);
      await this.db.put(story);
    }

    async reportContent(reporterId, targetId, reason = 'spam') {
      const report = { type: 'report', reporterId, targetId, reason, status: 'open', createdAt: Date.now() };
      const id = await this.db.put(report);
      this.createNotification({ userId: 'admin', kind: 'report', message: `Content reported: ${reason}` });
      return { ...report, id };
    }

    async blockUser(blockerId, blockedId) {
      await this.db.link(blockerId, blockedId, 'blocks');
      await this.db.put({ type: 'block', blockerId, blockedId, createdAt: Date.now() });
    }

    async unblockUser(blockerId, blockedId) {
      const blocks = await this.db.map({ query: { type: 'block', blockerId, blockedId } });
      for (const b of blocks) await this.db.remove(b.id);
    }

    async isBlocked(userId, otherId) {
      const blocks = await this.db.map({ query: { type: 'block', blockerId: otherId, blockedId: userId } });
      return blocks.length > 0;
    }

    async getBlockedUsers(userId) {
      const blocks = await this.db.map({ query: { type: 'block', blockerId: userId } });
      return Promise.all(blocks.map(b => this.getUser(b.blockedId)));
    }

    async setUserId(id) {
      this.userId = id;
      localStorage.setItem('fannalo_user_id', id);
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

    async _hash(str) {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const hash = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  };
})();

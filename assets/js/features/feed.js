(function () {
  window.FannaloFeed = class FannaloFeed {
    constructor(db, p2p, auth, torrent) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
      this.torrent = torrent;
      this.posts = [];
      this.currentPage = 1;
      this.loading = false;
      this.hasMore = true;
    }

    async loadFeed(page = 1, limit = 10) {
      if (!this.auth.currentUser) return [];
      this.loading = true;
      try {
        const blocked = await this.db.getBlockedUsers(this.auth.currentUser.id);
        const blockedIds = new Set(blocked.map(b => b.id));
        const posts = await this.db.getFeed(this.auth.currentUser.id, page * limit);
        this.posts = posts.filter(p => !blockedIds.has(p.authorId));
        this.hasMore = this.posts.length === page * limit;
        return this.posts;
      } catch (e) {
        console.error('Feed load error:', e);
        return [];
      } finally {
        this.loading = false;
      }
    }

    async createPost({ content, media, mediaType, isPremium, premiumPrice, requiredTier, tags, poll }) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      let torrentInfo = null;
      if (media && media.length > 0 && this.torrent) {
        for (const file of media) {
          const result = await this.torrent.sharePhoto(file);
          if (result?.infoHash) { torrentInfo = { infoHash: result.infoHash, magnetURI: result.magnetURI }; break; }
        }
      }
      const post = await this.db.createPost({
        authorId: this.auth.currentUser.id, content,
        media: torrentInfo ? [torrentInfo] : [], mediaType, isPremium, premiumPrice,
        requiredTier: requiredTier || null, tags
      });
      if (poll) {
        const p = await this.db.createPoll({ postId: post.id, question: poll.question, options: poll.options });
        post.poll = p;
      }
      if (this.p2p?.broadcast) this.p2p.broadcast({ type: 'feed:update', action: 'new_post', postId: post.id, authorId: this.auth.currentUser.id, timestamp: Date.now() });
      return post;
    }

    async toggleLike(postId) {
      if (!this.auth.currentUser) return false;
      const post = this.posts.find(p => p.id === postId) || await this.db.get(postId);
      if (!post) return false;
      const liked = post.likedBy?.includes(this.auth.currentUser.id);
      if (liked) {
        await this.db.unlikePost(postId, this.auth.currentUser.id);
        post.likes = Math.max(0, (post.likes || 0) - 1);
        post.likedBy = (post.likedBy || []).filter(id => id !== this.auth.currentUser.id);
        return false;
      } else {
        await this.db.likePost(postId, this.auth.currentUser.id);
        post.likes = (post.likes || 0) + 1;
        if (!post.likedBy) post.likedBy = [];
        post.likedBy.push(this.auth.currentUser.id);
        return true;
      }
    }

    async addComment(postId, text) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      const comment = await this.db.put({ type: 'comment', postId, authorId: this.auth.currentUser.id, text, createdAt: Date.now() });
      const post = await this.db.get(postId);
      if (post) { post.comments = (post.comments || 0) + 1; await this.db.put(post); }
      return comment;
    }

    async sendTip(postId, fromUserId, toUserId, amount) {
      return await this.db.addTip(fromUserId, toUserId, postId, amount);
    }

    async reportPost(postId, reason = 'spam') {
      if (!this.auth.currentUser) return;
      await this.db.reportContent(this.auth.currentUser.id, postId, reason);
    }

    renderPost(post) {
      if (!post) return document.createElement('div');
      const div = document.createElement('div');
      div.className = 'feed-card fade-in-up';
      div.dataset.postId = post.id;
      const isLiked = post.likedBy?.includes(this.auth.currentUser?.id);
      const isOwn = this.auth.currentUser && post.authorId === this.auth.currentUser.id;

      const tierBadges = { basic: 'badge-success', premium: 'badge-accent', vip: 'badge-warning' };
      const tierLabel = post.requiredTier ? `<span class="badge ${tierBadges[post.requiredTier] || 'badge-accent'}" style="font-size:10px;">${post.requiredTier}</span>` : '';

      const mediaHtml = post.media?.length
        ? `<div class="feed-card-media">${
            post.mediaType === 'video'
              ? `<video src="${post.media[0].magnetURI || ''}" controls></video>`
              : `<img src="${post.media[0].magnetURI || ''}" alt="" loading="lazy" onerror="this.style.display='none'">`
          }</div>`
        : '';

      const premiumBadge = post.isPremium
        ? `<span class="badge badge-accent"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Premium</span>`
        : '';

      div.innerHTML = `
        <div class="feed-card-header">
          <div class="avatar avatar-md" style="background:${this._getAvatarColor(post.author?.username || '')}">${(post.author?.displayName || '?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <a href="profile.html?id=${post.authorId}" style="color:var(--text-primary);font-weight:600;font-size:14px;">${post.author?.displayName || 'Unknown'}</a>
              ${premiumBadge} ${tierBadge}
            </div>
            <div style="font-size:12px;color:var(--text-muted);">@${post.author?.username || 'unknown'} · ${this._timeAgo(post.createdAt)}</div>
          </div>
          <div style="position:relative;" class="more-menu-container">
            <button class="btn btn-ghost btn-icon more-btn" data-post-id="${post.id}">⋯</button>
            <div class="more-menu" style="display:none;position:absolute;top:100%;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:4px;z-index:50;min-width:160px;box-shadow:var(--shadow-md);">
              ${!isOwn ? `<button class="tip-btn" data-post-id="${post.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font-size:13px;color:var(--text-primary);background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);">💎 Tip</button>` : ''}
              ${!isOwn ? `<button class="report-btn" data-post-id="${post.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font-size:13px;color:var(--danger);background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);">🚩 Report</button>` : ''}
            </div>
          </div>
        </div>
        ${mediaHtml}
        <div class="feed-card-body">
          ${post.content ? `<p style="font-size:14px;line-height:1.7;color:var(--text-secondary);">${this._linkify(post.content)}</p>` : ''}
          ${post.tags?.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${post.tags.map(t => `<span style="font-size:12px;color:var(--accent);">#${t}</span>`).join('')}</div>` : ''}
          ${post.poll ? this._renderPollHTML(post.poll) : ''}
        </div>
        <div class="feed-card-actions">
          <button class="action-btn like-btn ${isLiked ? 'liked' : ''}" data-post-id="${post.id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="like-count">${post.likes || 0}</span>
          </button>
          <button class="action-btn comment-btn" data-post-id="${post.id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>${post.comments || 0}</span>
          </button>
          <button class="action-btn share-btn" data-post-id="${post.id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            <span>${post.shares || 0}</span>
          </button>
          ${!isOwn ? `<button class="action-btn tip-btn" data-post-id="${post.id}" style="margin-left:auto;" title="Send tip">💎</button>` : ''}
          ${post.isPremium && !isOwn ? `<button class="btn btn-primary btn-sm unlock-btn" data-post-id="${post.id}" style="margin-left:4px;">Unlock ${post.premiumPrice}cr</button>` : ''}
        </div>
        <div class="feed-card-footer">
          <div style="display:flex;gap:10px;align-items:center;">
            <div class="avatar avatar-sm" style="background:var(--gradient-1);font-size:10px;width:28px;height:28px;">${this.auth.currentUser ? this.auth.currentUser.displayName[0].toUpperCase() : '?'}</div>
            <input type="text" class="input comment-input" placeholder="Write a comment..." data-post-id="${post.id}" style="flex:1;padding:8px 14px;font-size:13px;">
          </div>
        </div>
      `;
      return div;
    }

    _renderPollHTML(poll) {
      if (!poll) return '';
      const total = poll.totalVotes || 1;
      return `
        <div style="margin-top:12px;padding:14px;background:var(--bg-secondary);border-radius:var(--radius-md);">
          <div style="font-size:14px;font-weight:600;margin-bottom:10px;">📊 ${poll.question}</div>
          ${poll.options.map((o, i) => {
            const pct = Math.round((o.votes / total) * 100);
            const voted = this.auth.currentUser && o.voters?.includes(this.auth.currentUser.id);
            return `
              <div class="poll-option" data-poll-id="${poll.id}" data-option="${i}" style="padding:8px 12px;margin-bottom:6px;border-radius:var(--radius-sm);background:${voted ? 'var(--accent-glow)' : 'var(--bg-card)'};cursor:pointer;position:relative;overflow:hidden;${voted ? 'border:1px solid var(--accent);' : 'border:1px solid var(--border);'}">
                <div style="position:absolute;top:0;left:0;bottom:0;width:${pct}%;background:${voted ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.04)'};transition:width 0.4s ease;"></div>
                <div style="position:relative;display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:13px;">${o.text}</span>
                  <span style="font-size:12px;color:var(--text-muted);">${pct}%${voted ? ' ✓' : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${total} vote${total > 1 ? 's' : ''}</div>
        </div>
      `;
    }

    async openTipModal(postId) {
      if (!this.auth.currentUser) return;
      const post = await this.db.get(postId);
      if (!post) return;
      const amount = await new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal" style="max-width:360px;">
            <div class="modal-body" style="text-align:center;padding:24px;">
              <div style="font-size:40px;margin-bottom:8px;">💎</div>
              <h3 style="font-size:16px;font-weight:600;margin-bottom:4px;">Send a Tip</h3>
              <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Support ${post.author?.displayName || 'this creator'}</p>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
                ${[1, 5, 10, 25, 50, 100].map(v => `<button class="btn btn-secondary tip-amount" data-amount="${v}" style="justify-content:center;">${v}</button>`).join('')}
              </div>
              <input type="number" id="tipCustom" class="input" placeholder="Custom amount" min="1" style="margin-bottom:12px;">
              <button id="sendTipBtn" class="btn btn-primary" style="width:100%;justify-content:center;">Send Tip</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
        let amount = 5;
        overlay.querySelectorAll('.tip-amount').forEach(b => b.addEventListener('click', () => {
          overlay.querySelectorAll('.tip-amount').forEach(x => x.className = 'btn btn-secondary tip-amount');
          b.className = 'btn btn-primary tip-amount';
          amount = parseInt(b.dataset.amount); document.getElementById('tipCustom').value = '';
        }));
        document.getElementById('tipCustom').addEventListener('input', function() {
          if (this.value) { overlay.querySelectorAll('.tip-amount').forEach(x => x.className = 'btn btn-secondary tip-amount'); amount = parseFloat(this.value) || 0; }
        });
        document.getElementById('sendTipBtn').onclick = async () => { overlay.remove(); resolve(amount); };
        overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(0); } });
      });
      if (amount > 0) {
        await this.sendTip(postId, this.auth.currentUser.id, post.authorId, amount);
        return amount;
      }
      return 0;
    }

    _getAvatarColor(username) {
      const colors = ['#00d4ff','#7c3aed','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#8b5cf6'];
      let h = 0;
      for (let i = 0; i < (username || '').length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
      return colors[Math.abs(h) % colors.length];
    }

    _timeAgo(t) { if (!t) return 'recently'; const s = Math.floor((Date.now() - t) / 1000); if (s < 60) return 'just now'; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`; return new Date(t).toLocaleDateString(); }

    _linkify(text) {
      return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/@(\w+)/g, '<a href="profile.html?username=$1" style="color:var(--accent);">@$1</a>');
    }
  };
})();

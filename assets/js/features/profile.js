(function () {
  window.FannaloProfile = class FannaloProfile {
    constructor(db, p2p, auth) {
      this.db = db;
      this.p2p = p2p;
      this.auth = auth;
    }

    async loadProfile(userId) {
      const user = await this.db.getUser(userId);
      if (!user) return null;

      const isBlocked = this.auth.currentUser ? await this.db.isBlocked(this.auth.currentUser.id, userId) : false;
      const posts = isBlocked ? [] : (await this.db.map({ query: { type: 'post', authorId: userId } })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const followers = user.followers || 0;
      const following = user.following || 0;
      const subscribers = await this.db.getSubscribers(userId);

      let isFollowing = false, isSubscribed = false, subscriptionTier = null;
      if (this.auth.currentUser && this.auth.currentUser.id !== userId) {
        const follows = await this.db.map({ query: { type: 'follows', source: this.auth.currentUser.id, target: userId } });
        isFollowing = follows.length > 0;
        const subs = await this.db.map({ query: { type: 'subscription', subscriberId: this.auth.currentUser.id, creatorId: userId, active: true } });
        if (subs.length > 0) { isSubscribed = true; subscriptionTier = subs[0].tier; }
      }

      return {
        user, posts, stats: { followers, following, posts: posts.length, subscribers: subscribers.length },
        isFollowing, isSubscribed, subscriptionTier, isBlocked
      };
    }

    async updateProfile(userId, updates) {
      return await this.db.updateUser(userId, updates);
    }

    async toggleFollow(targetId) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      const existing = await this.db.map({
        query: { type: 'follows', source: this.auth.currentUser.id, target: targetId }
      });

      if (existing.length > 0) {
        await this.db.remove(existing[0].id);
        const target = await this.db.getUser(targetId);
        if (target) {
          target.followers = Math.max(0, (target.followers || 0) - 1);
          await this.db.put(target);
        }
        return false;
      } else {
        await this.db.follow(this.auth.currentUser.id, targetId);
        return true;
      }
    }

    async subscribeTiered(userId, creatorId, tier) {
      return await this.db.subscribeTiered(userId, creatorId, tier);
    }

    async toggleBlock(targetId) {
      if (!this.auth.currentUser) return false;
      const blocked = await this.db.isBlocked(this.auth.currentUser.id, targetId);
      if (blocked) { await this.db.unblockUser(this.auth.currentUser.id, targetId); return false; }
      else { await this.db.blockUser(this.auth.currentUser.id, targetId); return true; }
    }

    renderProfileHeader(profile, isOwner) {
      const { user, stats, isFollowing, isSubscribed } = profile;
      const container = document.createElement('div');
      container.className = 'fade-in';

      const coverGradient = user.coverPhoto
        ? `url(${user.coverPhoto})`
        : 'linear-gradient(135deg, #00d4ff 0%, #7c3aed 50%, #1a0a2e 100%)';

      container.innerHTML = `
        <div style="position:relative;border-radius:var(--radius-xl);overflow:hidden;background:var(--bg-card);border:1px solid var(--border);">
          <div style="height:200px;background:${coverGradient};background-size:cover;background-position:center;"></div>
          <div style="padding:0 24px 24px;margin-top:-48px;display:flex;gap:20px;align-items:flex-end;">
            <div class="avatar avatar-xl" style="background:var(--gradient-1);border:4px solid var(--bg-primary);font-size:36px;box-shadow:var(--shadow-md);">
              ${(user.displayName || user.username || '?')[0].toUpperCase()}
            </div>
            <div style="flex:1;padding-top:48px;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div>
                  <h1 style="font-size:22px;">${user.displayName || user.username}</h1>
                  <div style="font-size:14px;color:var(--text-muted);">@${user.username}</div>
                </div>
                ${user.isCreator ? '<span class="badge badge-accent" style="font-size:11px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Creator</span>' : ''}
                ${user.isSuperPeer ? '<span class="badge badge-success" style="font-size:11px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg> Super Peer</span>' : ''}
              </div>
              ${user.bio ? `<p style="margin-top:8px;font-size:14px;color:var(--text-secondary);">${user.bio}</p>` : ''}
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              ${!isOwner ? `
                ${user.isCreator ? `
                  <div class="subscribe-group" style="position:relative;">
                    <button class="btn ${isSubscribed ? 'btn-secondary' : 'btn-primary'} subscribe-btn" data-user-id="${user.id}">
                      ${isSubscribed ? `✓ ${profile.subscriptionTier || 'Subscribed'}` : 'Subscribe'}
                    </button>
                    ${!isSubscribed ? `
                    <div class="tier-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:6px;z-index:50;min-width:180px;box-shadow:var(--shadow-md);">
                      <button class="tier-option" data-tier="basic" data-user-id="${user.id}" style="display:flex;flex-direction:column;align-items:flex-start;width:100%;padding:10px 12px;background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);text-align:left;">
                        <span style="font-size:14px;font-weight:600;color:var(--text-primary);">Basic · 5cr/month</span>
                        <span style="font-size:11px;color:var(--text-muted);">Access to basic content</span>
                      </button>
                      <button class="tier-option" data-tier="premium" data-user-id="${user.id}" style="display:flex;flex-direction:column;align-items:flex-start;width:100%;padding:10px 12px;background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);text-align:left;">
                        <span style="font-size:14px;font-weight:600;color:var(--accent);">Premium · 15cr/month</span>
                        <span style="font-size:11px;color:var(--text-muted);">All content + exclusive posts</span>
                      </button>
                      <button class="tier-option" data-tier="vip" data-user-id="${user.id}" style="display:flex;flex-direction:column;align-items:flex-start;width:100%;padding:10px 12px;background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);text-align:left;">
                        <span style="font-size:14px;font-weight:600;color:var(--warning);">VIP · 50cr/month</span>
                        <span style="font-size:11px;color:var(--text-muted);">Everything + direct messages + priority</span>
                      </button>
                    </div>
                    ` : ''}
                  </div>
                ` : ''}
                <button class="btn ${isFollowing ? 'btn-secondary' : 'btn-ghost'} follow-btn" data-user-id="${user.id}">
                  ${isFollowing ? 'Following' : 'Follow'}
                </button>
                ${!isOwner ? `
                <div style="position:relative;" class="more-menu-container">
                  <button class="btn btn-ghost btn-icon" id="profileMoreBtn">⋯</button>
                  <div class="profile-more-menu" style="display:none;position:absolute;top:100%;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:4px;z-index:50;min-width:150px;box-shadow:var(--shadow-md);">
                    <button class="block-btn" data-user-id="${user.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font-size:13px;color:var(--danger);background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);">🚫 Block</button>
                    <button class="report-profile-btn" data-user-id="${user.id}" style="display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;font-size:13px;color:var(--danger);background:none;border:none;cursor:pointer;border-radius:var(--radius-sm);">🚩 Report</button>
                  </div>
                </div>
                ` : `
                <button class="btn btn-secondary" onclick="window.location.href='settings.html'">Edit Profile</button>
                `} ` : ''}
            </div>
          </div>
          <div style="display:flex;gap:32px;padding:16px 24px;border-top:1px solid var(--border);">
            <div><div style="font-weight:700;font-size:18px;">${stats.posts}</div><div style="font-size:12px;color:var(--text-muted);">Posts</div></div>
            <div><div style="font-weight:700;font-size:18px;">${stats.followers}</div><div style="font-size:12px;color:var(--text-muted);">Followers</div></div>
            <div><div style="font-weight:700;font-size:18px;">${stats.following}</div><div style="font-size:12px;color:var(--text-muted);">Following</div></div>
            <div><div style="font-weight:700;font-size:18px;">${stats.subscribers}</div><div style="font-size:12px;color:var(--text-muted);">Subscribers</div></div>
            ${user.isCreator ? `<div><div style="font-weight:700;font-size:18px;">${this._formatCredits(user.earnings)}</div><div style="font-size:12px;color:var(--text-muted);">Earnings</div></div>` : ''}
          </div>
        </div>
      `;

      return container;
    }

    renderPostGrid(posts) {
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:20px;';

      if (!posts || posts.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1;">
            <div class="empty-state-icon">📷</div>
            <h3 style="color:var(--text-secondary);margin-bottom:8px;">No posts yet</h3>
            <p style="color:var(--text-muted);font-size:14px;">When they post, it'll show up here.</p>
          </div>
        `;
        return grid;
      }

      posts.forEach(post => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'overflow:hidden;cursor:pointer;';
        card.onclick = () => window.location.href = `feed.html?post=${post.id}`;

        const hasMedia = post.media && post.media.length > 0;

        card.innerHTML = `
          <div style="aspect-ratio:1;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;overflow:hidden;">
            ${hasMedia && post.mediaType === 'image'
              ? `<img src="${post.media[0].magnetURI || ''}" alt="" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.style.display='none'">`
              : hasMedia && post.mediaType === 'video'
                ? `<div style="text-align:center;color:var(--text-muted);"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`
                : `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">${post.content?.substring(0, 80) || ''}${(post.content?.length || 0) > 80 ? '...' : ''}</div>`
            }
          </div>
          <div style="padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:13px;color:var(--text-muted);">
            <span>❤️ ${post.likes || 0}</span>
            <span>💬 ${post.comments || 0}</span>
            ${post.isPremium ? '<span style="margin-left:auto;" class="badge badge-accent" style="font-size:10px;">Premium</span>' : ''}
          </div>
        `;

        grid.appendChild(card);
      });

      return grid;
    }

    _formatCredits(amount) {
      if (!amount) return '$0';
      if (amount >= 1000) return '$' + (amount / 1000).toFixed(1) + 'K';
      return '$' + amount.toFixed(2);
    }
  };
})();

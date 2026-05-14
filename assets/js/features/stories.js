(function () {
  window.FannaloStories = class FannaloStories {
    constructor(db, auth) {
      this.db = db;
      this.auth = auth;
      this.currentIndex = 0;
      this.stories = [];
    }

    async loadFeed() {
      const stories = await this.db.getActiveStories();
      const enriched = await Promise.all(
        stories.map(async s => {
          const author = await this.db.getUser(s.authorId);
          return { ...s, author: author || { displayName: 'Unknown', username: 'unknown' } };
        })
      );
      const grouped = new Map();
      enriched.forEach(s => {
        if (!grouped.has(s.authorId)) grouped.set(s.authorId, []);
        grouped.get(s.authorId).push(s);
      });
      this.stories = Array.from(grouped.entries()).map(([userId, userStories]) => ({
        userId,
        author: userStories[0].author,
        stories: userStories
      }));
      return this.stories;
    }

    async create(media, text = '', mediaType = 'image') {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      return await this.db.createStory({
        authorId: this.auth.currentUser.id,
        media: [media],
        mediaType,
        text
      });
    }

    async view(storyId) {
      if (!this.auth.currentUser) return;
      await this.db.viewStory(storyId, this.auth.currentUser.id);
    }

    renderStoryRing(group, allViewed) {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;min-width:72px;';
      const hasUnviewed = group.stories.some(s => !this.auth.currentUser || !s.views.includes(this.auth.currentUser.id));
      div.innerHTML = `
        <div style="width:64px;height:64px;border-radius:50%;padding:3px;background:${hasUnviewed ? 'var(--gradient-1)' : 'var(--border)'};display:flex;align-items:center;justify-content:center;">
          <div class="avatar avatar-md" style="width:58px;height:58px;font-size:20px;background:var(--bg-card);border:3px solid var(--bg-primary);">
            ${(group.author?.displayName || '?')[0]}
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);text-align:center;max-width:72px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${group.author?.displayName || 'Unknown'}
        </div>
      `;
      return div;
    }

    renderStoryViewer(story, onNext, onPrev, onClose) {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:#000;z-index:500;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
        <div style="position:absolute;top:0;left:0;right:0;padding:16px;display:flex;align-items:center;gap:12px;z-index:2;">
          <div class="avatar avatar-sm" style="background:var(--gradient-1);font-size:12px;width:32px;height:32px;">${(story.author?.displayName || '?')[0]}</div>
          <span style="font-size:14px;font-weight:600;color:#fff;">${story.author?.displayName || 'Unknown'}</span>
          <span style="font-size:12px;color:rgba(255,255,255,0.5);">${this._timeAgo(story.createdAt)}</span>
          <button id="storyClose" style="margin-left:auto;background:none;border:none;color:#fff;font-size:24px;cursor:pointer;">&times;</button>
        </div>
        <div style="width:100%;max-width:400px;max-height:80vh;position:relative;">
          ${story.mediaType === 'video'
            ? `<video src="${story.media?.[0] || ''}" autoplay controls style="width:100%;max-height:80vh;object-fit:contain;border-radius:12px;"></video>`
            : `<img src="${story.media?.[0] || ''}" alt="" style="width:100%;max-height:80vh;object-fit:contain;border-radius:12px;" onerror="this.outerHTML='<div style=\\'text-align:center;padding:40px;color:#888;\\'>📸 Story</div>'">`
          }
          ${story.text ? `<p style="color:#fff;text-align:center;margin-top:16px;font-size:16px;">${story.text}</p>` : ''}
        </div>
        <button id="storyPrev" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:32px;width:48px;height:48px;border-radius:50%;cursor:pointer;display:${onPrev ? 'flex' : 'none'};align-items:center;justify-content:center;">&larr;</button>
        <button id="storyNext" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:32px;width:48px;height:48px;border-radius:50%;cursor:pointer;display:${onNext ? 'flex' : 'none'};align-items:center;justify-content:center;">&rarr;</button>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#storyClose').onclick = () => { overlay.remove(); onClose?.(); };
      overlay.querySelector('#storyNext')?.addEventListener('click', () => { overlay.remove(); onNext?.(); });
      overlay.querySelector('#storyPrev')?.addEventListener('click', () => { overlay.remove(); onPrev?.(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); onClose?.(); } });

      this.view(story.id);
      return overlay;
    }

    _timeAgo(t) {
      if (!t) return '';
      const s = Math.floor((Date.now() - t) / 1000);
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      return `${h}h ago`;
    }
  };
})();

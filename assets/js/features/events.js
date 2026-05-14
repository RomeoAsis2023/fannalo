(function () {
  window.FannaloEvents = class FannaloEvents {
    constructor(db, auth) {
      this.db = db;
      this.auth = auth;
    }

    async create(data) {
      if (!this.auth.currentUser) throw new Error('Not authenticated');
      const event = {
        type: 'event',
        authorId: this.auth.currentUser.id,
        title: data.title,
        description: data.description || '',
        date: data.date,
        endDate: data.endDate || data.date,
        location: data.location || '',
        isOnline: data.isOnline || false,
        meetingLink: data.meetingLink || '',
        isPremium: data.isPremium || false,
        price: data.price || 0,
        coverImage: data.coverImage || '',
        attendees: [],
        maxAttendees: data.maxAttendees || 0,
        tags: data.tags || [],
        createdAt: Date.now()
      };
      const id = await this.db.put(event);
      return { ...event, id };
    }

    async getUpcoming(limit = 20) {
      const events = await this.db.map({ query: { type: 'event' } });
      const now = Date.now();
      const upcoming = events
        .filter(e => new Date(e.date).getTime() > now)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, limit);
      return await this._enrich(upcoming);
    }

    async getPast(limit = 20) {
      const events = await this.db.map({ query: { type: 'event' } });
      const now = Date.now();
      const past = events
        .filter(e => new Date(e.date).getTime() <= now)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, limit);
      return await this._enrich(past);
    }

    async getMyEvents() {
      const events = await this.db.map({ query: { type: 'event', authorId: this.auth.currentUser?.id } });
      return await this._enrich(events.sort((a, b) => new Date(a.date) - new Date(b.date)));
    }

    async rsvp(eventId) {
      const event = await this.db.get(eventId);
      if (!event) throw new Error('Event not found');
      if (!event.attendees) event.attendees = [];
      if (event.attendees.includes(this.auth.currentUser.id)) return false;
      if (event.maxAttendees > 0 && event.attendees.length >= event.maxAttendees) {
        throw new Error('Event is full');
      }
      event.attendees.push(this.auth.currentUser.id);
      await this.db.put(event);
      return true;
    }

    async unrsvp(eventId) {
      const event = await this.db.get(eventId);
      if (!event) return false;
      if (!event.attendees) return false;
      event.attendees = event.attendees.filter(id => id !== this.auth.currentUser.id);
      await this.db.put(event);
      return true;
    }

    async getEvent(eventId) {
      const event = await this.db.get(eventId);
      if (!event) return null;
      const author = await this.db.getUser(event.authorId);
      const attendees = await Promise.all(
        (event.attendees || []).map(id => this.db.getUser(id))
      );
      return { ...event, author, attendees: attendees.filter(Boolean) };
    }

    async getCalendarEvents(startDate, endDate) {
      const events = await this.getUpcoming(100);
      return events.filter(e => {
        const d = new Date(e.date).getTime();
        return d >= startDate && d <= endDate;
      });
    }

    async _enrich(events) {
      return await Promise.all(events.map(async e => {
        const author = await this.db.getUser(e.authorId);
        return { ...e, author: author || { displayName: 'Unknown', username: 'unknown' } };
      }));
    }

    renderCard(event) {
      const div = document.createElement('div');
      div.className = 'card';
      div.style.cssText = 'overflow:hidden;';

      const eventDate = new Date(event.date);
      const isPast = eventDate.getTime() < Date.now();
      const isAttending = event.attendees && this.auth.currentUser &&
        event.attendees.includes(this.auth.currentUser.id);

      const month = eventDate.toLocaleString('default', { month: 'short' });
      const day = eventDate.getDate();

      div.innerHTML = `
        <div style="display:flex;">
          <div style="width:80px;flex-shrink:0;background:var(--gradient-1);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:rgba(255,255,255,0.8);">${month}</div>
            <div style="font-size:28px;font-weight:800;color:#fff;">${day}</div>
          </div>
          <div style="flex:1;padding:16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">${event.title}</h3>
                <p style="font-size:12px;color:var(--text-muted);">
                  ${eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  ${event.location ? ` · ${event.location}` : ''}
                  ${event.isOnline ? ' · Online' : ''}
                </p>
              </div>
              ${event.isPremium ? '<span class="badge badge-accent" style="font-size:10px;">Premium</span>' : ''}
            </div>
            ${event.description ? `<p style="font-size:13px;color:var(--text-secondary);margin-top:8px;">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</p>` : ''}
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
              <div style="font-size:12px;color:var(--text-muted);">
                👤 ${event.attendees?.length || 0} ${event.maxAttendees > 0 ? `/ ${event.maxAttendees}` : ''} attending
                ${event.author ? ` · by ${event.author.displayName}` : ''}
              </div>
              ${!isPast ? `
                <button class="btn ${isAttending ? 'btn-secondary' : 'btn-primary'} btn-sm rsvp-btn" data-event-id="${event.id}">
                  ${isAttending ? '✓ Attending' : 'RSVP'}
                </button>
              ` : '<span style="font-size:11px;color:var(--text-muted);">Past event</span>'}
            </div>
          </div>
        </div>
      `;
      return div;
    }

    renderCalendarCell(day, events) {
      const cell = document.createElement('div');
      cell.style.cssText = `padding:4px;min-height:80px;border-radius:var(--radius-sm);${events.length > 0 ? 'background:var(--bg-card);' : ''}`;
      cell.innerHTML = `
        <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:4px;">${day}</div>
        ${events.slice(0, 3).map(e => `
          <div style="font-size:10px;padding:2px 4px;margin-bottom:2px;border-radius:4px;background:var(--accent-glow);color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;" title="${e.title}">
            ${e.title}
          </div>
        `).join('')}
        ${events.length > 3 ? `<div style="font-size:10px;color:var(--text-muted);">+${events.length - 3} more</div>` : ''}
      `;
      return cell;
    }
  };
})();

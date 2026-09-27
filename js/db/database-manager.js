import { upgradeSchema } from './schema.js';
import { DatabaseContext } from './database-context.js';
import { SCHEMA_VERSION, APP_VERSION } from '../core/constants.js';
import { events } from '../core/events.js';

export class DatabaseManager {
  constructor(reg) {
    this.reg = reg;
    this.current = null;
  }

  open(profile) {
    if (!profile?.databaseName) {
      return Promise.reject(new Error('ملف قاعدة البيانات غير صالح.'));
    }

    return new Promise((resolve, reject) => {
      const r = indexedDB.open(profile.databaseName, SCHEMA_VERSION);
      let settled = false;

      const fail = (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };

      r.onupgradeneeded = (e) => {
        try {
          events.emit('db:migration:starting', {
            profileId: profile.id,
            databaseName: profile.databaseName,
            version: SCHEMA_VERSION
          });
          upgradeSchema(e.target.result, e.target.transaction);
        } catch (err) {
          try {
            e.target.transaction.abort();
          } catch (abortErr) {
            // Ignored
          }
          fail(err);
        }
      };

      r.onblocked = () => fail(new Error('قاعدة البيانات مشغولة في نافذة أخرى. أغلق النسخ الأخرى ثم أعد المحاولة.'));
      r.onerror = () => fail(r.error || new Error('تعذر فتح قاعدة البيانات'));

      r.onsuccess = () => {
        if (settled) {
          try {
            r.result.close();
          } catch (closeErr) {
            // Ignored
          }
          return;
        }

        settled = true;
        const db = r.result;

        db.onversionchange = () => {
          events.emit('db:closing', {
            profileId: profile.id,
            databaseName: profile.databaseName
          });
          db.close();
        };

        const c = new DatabaseContext(db, profile);
        this.current = c;
        this.reg.update(profile.id, {
          schemaVersion: SCHEMA_VERSION,
          applicationVersion: APP_VERSION
        });

        events.emit('db:migration:completed', {
          profileId: profile.id,
          databaseName: profile.databaseName,
          version: SCHEMA_VERSION
        });

        resolve(c);
      };
    });
  }

  async openActive() {
    const p = this.reg.ensureDefault() || this.reg.active;
    return this.open(p);
  }

  async switchTo(id) {
    const target = this.reg.data.profiles.find((p) => p.id === id);
    if (!target) throw new Error('قاعدة البيانات غير موجودة.');
    if (target.status === 'archived') {
      throw new Error('لا يمكن فتح قاعدة بيانات مؤرشفة. أعد تفعيلها أولًا.');
    }

    if (this.current?.profile?.id === id && !this.current.closed) {
      return this.current;
    }

    const previous = this.current;
    const next = await this.open(target);
    this.current = next;

    if (previous && previous !== next) {
      events.emit('db:closing', {
        profileId: previous.profile.id,
        databaseName: previous.profile.databaseName
      });
      previous.close();
    }

    this.reg.switch(id);
    events.emit('db:switched', {
      profileId: id,
      databaseName: target.databaseName,
      token: next.token
    });

    return next;
  }

  closeCurrent() {
    if (this.current) {
      events.emit('db:closing', {
        profileId: this.current.profile.id,
        databaseName: this.current.profile.databaseName
      });
      this.current.close();
      this.current = null;
    }
  }
}

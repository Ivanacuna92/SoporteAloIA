const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'mute-states.json');

class MuteManager {
    constructor() {
        this.states = {};
        this.load();
    }

    load() {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            if (fs.existsSync(STATE_FILE)) {
                const raw = fs.readFileSync(STATE_FILE, 'utf-8');
                this.states = JSON.parse(raw || '{}');
            }
        } catch (error) {
            console.error('Error cargando mute-states:', error.message);
            this.states = {};
        }
    }

    persist() {
        try {
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.states, null, 2));
        } catch (error) {
            console.error('Error guardando mute-states:', error.message);
        }
    }

    isMuted(phone) {
        return !!this.states[phone];
    }

    setMute(phone, muted) {
        if (muted) {
            this.states[phone] = { mutedAt: new Date().toISOString() };
        } else {
            delete this.states[phone];
        }
        this.persist();
    }

    getAll() {
        const result = {};
        Object.keys(this.states).forEach(phone => { result[phone] = true; });
        return result;
    }

    remove(phone) {
        delete this.states[phone];
        this.persist();
    }
}

module.exports = new MuteManager();

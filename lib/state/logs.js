export class RingLog {
    max;
    enabled;
    entries = [];
    constructor(max = 200, enabled = true) {
        this.max = max;
        this.enabled = enabled;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled)
            this.entries = [];
    }
    add(entry) {
        if (!this.enabled)
            return;
        this.entries.push(entry);
        if (this.entries.length > this.max)
            this.entries.splice(0, this.entries.length - this.max);
    }
    list(limit = 50) {
        const count = Math.max(1, Math.min(200, Math.round(limit)));
        return this.entries.slice(-count).reverse().map((entry) => ({ ...entry }));
    }
    clear() {
        this.entries = [];
    }
    size() {
        return this.entries.length;
    }
}

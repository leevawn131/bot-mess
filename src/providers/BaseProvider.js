class BaseProvider {
    constructor(name) {
        this.name = name;
    }

    async chat(prompt, options = {}) {
        throw new Error(`Method chat() not implemented in provider ${this.name}`);
    }

    async embedding(text) {
        throw new Error(`Method embedding() not implemented in provider ${this.name}`);
    }

    async health() {
        return { ok: true, provider: this.name };
    }
}

module.exports = BaseProvider;

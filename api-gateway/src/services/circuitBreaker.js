const logger = require('../utils/logger');

// CLOSED    -> calls pass through, failures are counted
// OPEN      -> calls are rejected immediately (no load on the broken service)
// HALF_OPEN -> after resetTimeout, ONE trial call decides: success -> CLOSED, failure -> OPEN
class CircuitBreaker {
  constructor({ name, failureThreshold = 3, resetTimeoutMs = 10000 }) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = 0;
    this.trialInFlight = false;
  }

  _transition(next) {
    if (this.state !== next) {
      logger.warn('circuit_state_change', { breaker: this.name, from: this.state, to: next });
      this.state = next;
    }
  }

  _openError() {
    const err = new Error(`circuit '${this.name}' is OPEN`);
    err.code = 'CIRCUIT_OPEN';
    return err;
  }

  async exec(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) this._transition('HALF_OPEN');
      else throw this._openError();
    }
    let isTrial = false;
    if (this.state === 'HALF_OPEN') {
      if (this.trialInFlight) throw this._openError();
      this.trialInFlight = true;
      isTrial = true;
    }
    try {
      const result = await fn();
      this.failures = 0;
      this._transition('CLOSED');
      return result;
    } catch (err) {
      this.failures += 1;
      if (isTrial || this.failures >= this.failureThreshold) {
        this.openedAt = Date.now();
        this._transition('OPEN');
      }
      throw err;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }

  snapshot() {
    return { name: this.name, state: this.state, failures: this.failures, threshold: this.failureThreshold };
  }
}

module.exports = CircuitBreaker;

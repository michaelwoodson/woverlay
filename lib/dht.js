'use strict';

let cryptoJs = require('crypto-js');

const TIMEOUT_SECONDS = 60;

class DHT {
	constructor(overlay) {
		this.overlay = overlay;
		this.overlay.messageListeners.push(new OverlayMessageListener(this));
		this.storage = new Map();
		this.messagePromises = new Map();
		this.messageCounter = 0;
	}

	put(key, value, id) {
		let hashedKey = cryptoJs.SHA256(key).toString();
		let message = this.messageCounter++;
		let resolved = false;
		let result = new Promise((resolve, reject) => {
			if (this.overlay.inFloodRange(hashedKey)) {
				resolved = true;
				let data = this.storage.get(key);
				if (!data) {
					data = {};
					this.storage.set(key, data);
				}
				data[id] = value;
				resolve();
			} else {
				setTimeout(() => {
					//messages.delete(message);
					reject();
				}, TIMEOUT_SECONDS * 1000);
				this.overlay.sendToClosest('dht.put', hashedKey, {message: message, value: value});
			}
			if (!resolved) {
				this.messagePromises.set(message, {resolve: resolve});
			}
		});
		return result;
	}
	
	get(key) {
		let hashedKey = cryptoJs.SHA256(key).toString();
		let message = this.messageCounter++;
		let resolved = false;
		let result = new Promise((resolve, reject) => {
			if (this.overlay.inFloodRange(hashedKey)) {
				resolved = true;
				resolve(this.storage.get(key));
			} else {
				setTimeout(() => {
					//messages.delete(message);
					reject();
				}, TIMEOUT_SECONDS * 1000);
				this.overlay.sendToClosest('dht.get', hashedKey, {message: message});
			}
			if (!resolved) {
				this.messagePromises.set(message, {resolve: resolve});
			}
		});
		return result;
	}
}

class OverlayMessageListener {
	constructor(dht) {
		this.dht = dht;
	}
	
	messageArrived(envelope, signed) {
		if (envelope.overlay == 'dht.put') {
			let value = this.dht.storage.get(envelope.overlayToClosest);
			if (!value) {
				value = {};
				this.dht.storage.set(envelope.overlayToClosest, value);
			} 
			value[envelope.overlayFrom] = signed.value;
			this.dht.overlay.send('dht.put.ack', envelope.overlayFrom, {message: signed.message});
		} else if (envelope.overlay == 'dht.put.ack') {
			let promise = this.dht.messagePromises.get(signed.message);
			if (promise) {
				promise.resolve();
			} else {
				console.log('timed out put, need longer timeouts?');
			}
		} else if (envelope.overlay == 'dht.get') {
			let value = this.dht.storage.get(envelope.overlayToClosest);
			if (!value) {
				value = {};
			} 
			this.dht.overlay.send('dht.got', envelope.overlayFrom, {message: signed.message, value: value});
		} else if (envelope.overlay == 'dht.got') {
			let promise = this.dht.messagePromises.get(signed.message);
			if (promise) {
				promise.resolve(signed.value);
			} else {
				console.log('timed out get, need longer timeouts?');
			}
		}
	}
}

module.exports = DHT;

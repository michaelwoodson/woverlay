"use strict";

const CLEAN_UP_SECONDS = 5;
const CONNECTION_TIMEOUT_SECONDS = 20;
const CLEAN_UP_INTERVAL = CLEAN_UP_SECONDS * 1000;

/**
 * Module for cleaning the overlay network.
 * @exports cleaner
 */
let idhelper = require('./idhelper.js');

class Cleaner {
	constructor(overlay) {
		this.overlay = overlay;
		this.queryTime = 0;
		this.allFingers = {};
		this.cleanUpHandle = null;
	}

	cleanUp(connection) {
		this.overlay.pendingEnvelopes.forEach(e => {
			e.proxies.length = 0;
			this.overlay.proxy(e);
		});
		this.overlay.pendingEnvelopes.length = 0;

		if (this.overlay && this.overlay.status && !this.overlay.status.subordinateMode) {
			this.checkFloodAndFingers(true);
			this.timeoutConnections();
		}
		this.cleanUpHandle = setTimeout(() => this.cleanUp(), CLEAN_UP_INTERVAL);
	}

	stop() {
		clearTimeout(this.cleanUpHandle);
		this.cleanUpHandle = null;
	}

	pendingConnection(connection) {
		let iceConnectionState = connection.pc.iceConnectionState;
		return iceConnectionState === 'connecting' || iceConnectionState === 'new' || iceConnectionState === 'checking';
	}

	expire(connection) {
		setTimeout(() => {
			if (this.pendingConnection(connection)) {
				this.overlay.webrtc.disconnect(connection);
			}
		}, CONNECTION_TIMEOUT_SECONDS * 1000);
	}

	timeoutConnections() {
		this.overlay.webrtc.connections.forEach(connection => {
			if (this.pendingConnection(connection)) {
				this.expire(connection);
			} else if (connection.pc.iceConnectionStatue === 'closed') {
				this.overlay.webrtc.disconnect(connection);
			}
		});
	}

	inactiveFinger(fingerId) {
		return 'pending' == fingerId || !(this.overlay.webrtc.getConnection(fingerId));
	}

	start() {
		this.cleanUpHandle = setTimeout(() => this.cleanUp(), CLEAN_UP_INTERVAL);
	}

	checkFloodAndFingers(retry) {
		let connections = this.overlay.getConnectedIds();
		let targetFlood = this.overlay.targetFlood();
		// Don't worry about fingers unless the flood network is full.
		if (targetFlood.length == this.overlay.totalFloodSize()) {
			// Check to see if the fingers should grow.
			let distance = idhelper.directedDistance(targetFlood[0], targetFlood[targetFlood.length -1]);
			// Each shift right is a divide by 2.	So start with HALF_MAX to trigger a finger and cut in half
			// for each finger.
			if (distance.compareTo(idhelper.HALF_MAX.shiftRight(this.overlay.fingers.length)) < 0) {
				this.overlay.fingers.push('pending');
				this.overlay.sendToClosest('findfinger', idhelper.getIdealFinger(this.overlay.localid.id, this.overlay.fingers.length - 1), {level: this.overlay.fingers.length - 1});
			}
			if (this.overlay.fingers.length > 0 && distance.compareTo(idhelper.HALF_MAX.shiftRight(this.overlay.fingers.length-1)) > 0) {
				console.log('time to remove a finger');
				this.overlay.fingers.pop();
			}
			if (retry) {
				for (let vIndex = 0; vIndex < this.overlay.fingers.length; vIndex++) {
					if (this.inactiveFinger(this.overlay.fingers[vIndex])) {
						this.overlay.fingers[vIndex] = 'pending';
						this.overlay.sendToClosest('findfinger', idhelper.getIdealFinger(this.overlay.localid.id, vIndex), {level: vIndex});
					}
				}
			}
		} else {
			this.overlay.fingers.length = 0;
		}

		// Build the fingers and make sure the flood network is marked as used.
		let notFloodOrFinger = [];
		for (let i = 0; i < connections.length; i++) {
			if (this.overlay.inFlood(connections[i])) {
				this.overlay.webrtc.markUsed(connections[i]);
			} else {
				let used = false;
				for (let fingerIndex = 0; fingerIndex < this.overlay.fingers.length; fingerIndex++) {
					used = used || this.overlay.fingers[fingerIndex] == connections[i];
				}
				if (!used) {
					notFloodOrFinger.push(connections[i]);
				}
			}
		}
		// Keep a few connections even if they aren't part of the flood or finger network.
		if (this.overlay.flood.length == this.overlay.FLOOD_SIZE * 2 + 1) {
			for (let i = 0; i < notFloodOrFinger.length; i++) {
				if (i <= 2) {
					this.overlay.webrtc.markUsed(notFloodOrFinger[i]);
				} else {
					this.overlay.webrtc.markUnused(notFloodOrFinger[i]);
				}
			}
		}
	}
}

module.exports = Cleaner;
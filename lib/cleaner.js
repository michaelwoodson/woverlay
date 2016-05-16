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
		let connectedIds = this.overlay.getConnectedIds();
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
				this.overlay.fingers.filter(f => this.inactiveFinger(f)).forEach((f, idx) => {
					this.overlay.fingers[idx] = 'pending';
					this.overlay.sendToClosest('findfinger', idhelper.getIdealFinger(this.overlay.localid.id, idx), {level: idx});
				})
			}
		} else {
			this.overlay.fingers.length = 0;
		}

		// Build the fingers and make sure the flood network is marked as used.
		let notFloodOrFinger = [];
		connectedIds.forEach(id => {
			if (this.overlay.inFlood(id)) {
				this.overlay.webrtc.markUsed(id);
			} else {
				let used = false;
				for (let fingerIndex = 0; fingerIndex < this.overlay.fingers.length; fingerIndex++) {
					if (this.overlay.fingers[fingerIndex] == id) {
						used = true;
						this.overlay.webrtc.markUsed(id);
					}
				}
				if (!used) {
					let connection = this.overlay.webrtc.connectionMap[id];
					if ((new Date().getTime() - connection.lastUse.getTime()) > (60 * 1000)) {
						notFloodOrFinger.push(id);
					} else {
						this.overlay.webrtc.markUsed(id);
					}
				}
			}
		});
		// Keep a few connections even if they aren't part of the flood or finger network.
		if (this.overlay.flood.length === this.overlay.totalFloodSize()) {
			notFloodOrFinger.forEach(id => this.overlay.webrtc.markUnused(id));
		}
	}
}

module.exports = Cleaner;
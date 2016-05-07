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
		this.allVerticals = {};
		this.cleanUpHandle = null;
	}

	cleanUp(connection) {
		this.overlay.pendingEnvelopes.forEach(e => {
			e.proxies.length = 0;
			this.overlay.proxy(e);
		});
		this.overlay.pendingEnvelopes.length = 0;

		if (this.overlay && this.overlay.status && !this.overlay.status.subordinateMode) {
			this.checkFloodAndVerticals(true);
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

	inactiveVertical(verticalId) {
		return 'pending' == verticalId || !(this.overlay.webrtc.getConnection(verticalId));
	}

	start() {
		this.cleanUpHandle = setTimeout(() => this.cleanUp(), CLEAN_UP_INTERVAL);
	}

	checkFloodAndVerticals(retry) {
		let connections = this.overlay.getConnectedIds();
		// Don't worry about verticals unless the flood network is full.
		if (this.overlay.flood.length == this.overlay.FLOOD_SIZE * 2 + 1) {
			// Check to see if the verticals should grow.
			let distance = idhelper.directedDistance(this.overlay.flood[0], this.overlay.flood[this.overlay.flood.length -1]);
			// Each shift right is a divide by 2.	So start with HALF_MAX to trigger a verical and cut in half
			// for each vertical.
			if (distance.compareTo(idhelper.HALF_MAX.shiftRight(this.overlay.verticals.length)) < 0) {
				this.overlay.verticals.push('pending');
				this.overlay.sendToClosest('findvertical', idhelper.getIdealVertical(this.overlay.localid.id, this.overlay.verticals.length - 1), {level: this.overlay.verticals.length - 1});
			}
			if (this.overlay.verticals.length > 0 && distance.compareTo(idhelper.HALF_MAX.shiftRight(this.overlay.verticals.length-1)) > 0) {
				console.log('time to remove a vertical');
				this.overlay.verticals.pop();
			}
			if (retry) {
				for (let vIndex = 0; vIndex < this.overlay.verticals.length; vIndex++) {
					if (inactiveVertical(this.overlay.verticals[vIndex])) {
						this.overlay.verticals[vIndex] = 'pending';
						this.overlay.sendToClosest('findvertical', idhelper.getIdealVertical(this.overlay.localid.id, vIndex), {level: vIndex});
					}
				}
			}
		} else {
			this.overlay.verticals.length = 0;
		}

		// Build the verticals and make sure the flood network is marked as used.
		let notFloodOrVertical = [];
		for (let i = 0; i < connections.length; i++) {
			if (this.overlay.inFlood(connections[i])) {
				this.overlay.webrtc.markUsed(connections[i]);
			} else {
				let used = false;
				for (let verticalIndex = 0; verticalIndex < this.overlay.verticals.length; verticalIndex++) {
					used = used || this.overlay.verticals[verticalIndex] == connections[i];
				}
				if (!used) {
					notFloodOrVertical.push(connections[i]);
				}
			}
		}
		// Keep a few connections even if they aren't part of the flood or vertical network.
		if (this.overlay.flood.length == this.overlay.FLOOD_SIZE * 2 + 1) {
			for (let i = 0; i < notFloodOrVertical.length; i++) {
				if (i <= 2) {
					this.overlay.webrtc.markUsed(notFloodOrVertical[i]);
				} else {
					this.overlay.webrtc.markUnused(notFloodOrVertical[i]);
				}
			}
		}
	}
}

module.exports.Cleaner = Cleaner;
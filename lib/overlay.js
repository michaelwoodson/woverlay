"use strict";

let WebRTC = require('./webrtc').WebRTC;
let WebSocketWrapper = require('./websocket').WebSocketWrapper;
let Cleaner = require('./cleaner').Cleaner;

let idhelper = require('./idhelper');
let signer = require('./signer')

class Overlay {
	constructor(localid, host) {
		this.FLOOD_SIZE = 2;
		this.verticals = [];
		this.flood = [];
		this.subordinates = [];
		this.messageListeners = [];
		this.connectionListeners = [];
		this.disconnectionListeners = [];
		this.status = {initialized: false, subordinateMode: false};
		this.localid = localid;
		this.webrtc  = new WebRTC(this.localid, this);
		this.websocket = new WebSocketWrapper(this, host);
		this.webrtc.listeners.push(() => this.onWebrtcChange());
		this.cleaner = new Cleaner(this);
	}
	
	connect(config) {
		this.websocket.connect(config);
		// Need to find a better way to start, hack to keep from running when testing.
		this.cleaner.start();
	}

	/**
	 * Returns an index into an array of the given length wrapped so that negative values read backwards
	 * from the end and values beyond the length of the array start back at the beginning.	Doesn't work
	 * for values less than -length or > 2 * length.
	 */
	wrapIndex(index, length) {
		if (index < 0) {
			return length + index;
		} else if (index >= length) {
			return index - length;
		} else {
			return index;
		}
	}

	loadFlood(connections) {
		connections.sort();
		if (connections.length < this.floodSize() * 2 + 1) {
			this.flood.length = 0;
			connections.forEach(c => this.flood.push(c));
		} else {
			this.flood.length = 0;
			let myIndex = 0;
			for (let i = 0; i < connections.length; i++) {
				if (connections[i] == this.localid.id) {
					myIndex = i;
					break;
				}
			}
			for (let i = -this.floodSize(); i <= this.floodSize(); i++) {
				let index = this.wrapIndex(myIndex + i, connections.length);
				this.flood.push(connections[index]);
			}
		}
	}

	inFlood(id) {
		return this.flood.indexOf(id) >= 0;
	}

	/**
	 * Update the overlay network when the webrtc connection state changed.
	 * This function is an event handler for webrtc state changes.
	 */
	onWebrtcChange() {
		let connections = this.getConnectedIds();
		if (this.status.subordinateMode) {
			if (!connections.indexOf(this.localid.id)) {
				//this.status.subordinateMode;
				//TODO: trigger reconnect?
			}
		} else {
			this.loadFlood(connections);
			this.cleaner.checkFloodAndVerticals(false);
		}
	}

	addConnection(connection, bootstrap) {
		connection.golden = true;
		this.onWebrtcChange();
		if (!this.status.subordinateMode) {
			if (!this.status.initialized) {
				if (bootstrap) {
					bootstrap.verticals.forEach(id => this.connectTo(id));
					bootstrap.flood.forEach(id => this.connectTo(id));
					// Get the floods from the edges to make sure the local flood has the right nodes.
					if (bootstrap.flood.length >= this.totalFloodSize()) {
						this.send('getflood', bootstrap.flood[0]);
						this.send('getflood', bootstrap.flood[bootstrap.flood.length - 1]);
					}
				}
				this.status.initialized = true;
			} else {
				if (this.flood.length < this.totalFloodSize()) {
					this.flood.filter(peerId => peerId != this.localid.id && peerId != connection.peerId && this.webrtc.active(peerId)).forEach(peerId => {
						this.sendFloodReport(peerId);
					});
				}
			}
			this.connectionListeners.forEach(l => l(connection.peerId));
		}
	}

	sendAround(overlayAction, distance) {
		let next = this.getNextInFlood();
		if (next) {
			let nextDistance = idhelper.distance(this.localid.id, next);
			if (distance) {
				distance = distance.add(nextDistance);
			} else {
				distance = nextDistance;
			}
			if (idhelper.withinMax(distance)) {
				this.send(overlayAction, next, {traveled: distance.toString()});
			} else {
				console.log('made it around');
			}
		}
	}

	getNextInFlood() {
		let index = this.flood.indexOf(this.localid.id);
		index = index == -1 ? 0 : index;
		index++;
		index = index >= this.flood.length ? 0 : index;
		if (this.flood[index] != this.localid.id) {
			return this.flood[index];
		} else {
			return null;
		}
	}

	/**
	 * Send an overlay message to the given recipient.
	 * @private
	 * @param {string} overlayAction The type of overlay message to send.
	 * @param {string} to The id to send to.
	 * @param {object} data The object to send.
	 */
	send(overlayAction, to, data) {
		let envelope = {};
		envelope.overlayFrom = this.localid.id;
		envelope.overlayFromInstance = this.localid.instanceId;
		envelope.overlayTo = to;
		envelope.action = 'overlay';
		envelope.overlay = overlayAction;
		envelope.proxies = [this.localid.id];
		envelope.data = signer.pack(data || {}, this.localid.key);
		if (envelope.overlayTo === this.localid.id) {
			this.onMessageArrived(envelope);
		} else {
			this.proxy(envelope);
		}
	}

	/**
	 * Send an overlay message to the closest id to the given target.
	 * @private
	 * @param {string} overlayAction The type of overlay message to send.
	 * @param {string} to The id to send to.
	 * @param {object} envelope The object to send.
	 */
	sendToClosest(overlayAction, to, data) {
		let envelope = {};
		envelope.overlayToClosest = to;
		envelope.data = signer.pack(data || {}, this.localid.key);
		envelope.overlayFrom = this.localid.id;
		envelope.overlayFromInstance = this.localid.instanceId;
		envelope.action = 'overlay';
		envelope.overlay = overlayAction;
		envelope.proxies = [this.localid.id];
		if (this.flood.length <= 1) {
			this.onMessageArrived(envelope);
		} else {
			this.proxy(envelope);
		}
	}

	/**
	 * Detect when part of the flood network is closed and query the network for
	 * a replacement.
	 */
	closed(id) {
		if (this.status.initialized && !this.status.subordinateMode && id != this.localid.id) {
			let index = this.flood.indexOf(id);
			if (index >= 0 && this.flood.length == (this.floodSize() * 2 + 1)) {
				let sideIndex;
				if (index > this.floodSize()) {
					sideIndex = this.floodSize() * 2;
					// Make sure not to try to use the id that was just closed.
					if (this.flood[sideIndex] == id) {
						sideIndex--;
					}
				} else {
					sideIndex = 0;
					// Make sure not to try to use the id that was just closed.
					if (this.flood[sideIndex] == id) {
						sideIndex++;
					}
				}
				this.send('getflood', this.flood[sideIndex]);
			}
			this.disconnectionListeners.forEach(l => l(id));
		}
	}

	proxy(envelope) {
		let to;
		// Check for direct connections to the target.
		let activeConnections = this.webrtc.getOpenConnections();
		if (this.status.subordinateMode) {
			to = this.localid.id;
		} else if (envelope.overlayToClosest) {
			let ids = [];
			activeConnections.forEach(connection => {
				let candidateId = connection.peerId;
				//if (envelope.overlayFrom != candidateId && !(envelope.proxies.indexOf(candidateId))) {
				if (envelope.overlayFrom != candidateId) {
					ids.push(candidateId);
				}
			});
			// TODO: should filter this
			to = idhelper.closest(envelope.overlayToClosest, ids);
			if (to) {
				//console.log('found closest proxy: ' + to);
			} else {
				console.log('Failed to send: ' + envelope.overlay + ' to closest: ' + envelope.overlayToClosest + ' ids: ' + ids.join(',') + ' from: ' + this.localid.id);
			}
		} else {
			// Check for any direct connections to the recipient.
			for (let i = 0; i < activeConnections.length; i++) {
				if (this.matchesAddress(envelope, activeConnections[i].peerId)) {
					to = this.filterRecipient(activeConnections[i].peerId, to, envelope);
					if (to) {
						break;
					}
				}
			}
			// Check for closest in flood or verticals.
			if (!to) {
				let options = this.flood.concat(this.verticals);
				while (!to && options.length) {
					let closest = idhelper.closest(envelope.overlayTo, options);
					to = this.filterRecipient(closest, to , envelope);
					if (!to) {
						idhelper.remove(closest, options);
					}
				}
			}
			// If all else fails, choose something from the active connections.
			if (!to) {
				for (let i = 0; i < activeConnections.length; i++) {
					to = this.filterRecipient(activeConnections[i].peerId, to, envelope);
					if (to) {
						break;
					}
				}
			}
			// Final end run for small/forming networks, return to sender.
			if (!to && envelope.overlayFrom != this.localid.id && this.flood.length < this.totalFloodSize() && this.flood.indexOf(envelope.from) >= 0) {
				to = envelope.from;
			}
			if (!to) {
				console.log(`Failed to send: ${envelope.overlay} to: ${envelope.overlayTo} from me: ${envelope.overlayFrom == this.localid.id}`);
			}
		}
		if (to) {
			//console.log('found proxy: ' + to);
			if (envelope.proxies.indexOf(this.localid.id) < 0) {
				envelope.proxies.push(this.localid.id);
			}
			envelope.to = to;
			this.webrtc.send(envelope);
		}
	}

	filterRecipient(proposedTo, currentTo, envelope) {
		if (currentTo || !this.webrtc.active(proposedTo) || proposedTo == this.localid.id) {
			return currentTo;
		} else {
			let found = envelope.proxies.indexOf(proposedTo) >= 0;
			if (found) {
				//console.log('proxy already used: ' + proposedTo);
			} else {
				return proposedTo;
			}
		}
		return null;
	}

	matchesAddress(envelope, id) {
		if (envelope.overlayToClosest) {
			let activeConnections = this.webrtc.getOpenConnections();
			let ids = [];
			activeConnections.forEach(connection => {
				if (envelope.overlayFrom != connection.peerId) {
					ids.push(connection.peerId);
				}
			});
			ids.push(this.localid.id);
			return idhelper.closest(envelope.overlayToClosest, ids) === id;
		}
		return envelope.overlayTo === id;
	}

	/**
	 * Get an array of ids that are currently connected.
	 * @private
	 */
	getConnectedIds() {
		let ids = [];
		let activeConnections = this.webrtc.connections;
		this.webrtc.connections.filter(c => c.peerId != this.localid.id && c.golden).forEach(c => ids.push(c.peerId));
		ids.push(this.localid.id);
		return ids;
	}

	onMessage(envelope) {
		if (this.matchesAddress(envelope, this.localid.id)) {
			this.onMessageArrived(envelope);
		} else {
			this.proxy(envelope);
		}
	}

	connectTo(id) {
		if (id != this.localid.id) {
			this.send('ringring', id);
		}
	}

	/**
	 * Called when a message is received.
	 * @param {object} envelope The message that was received.
	 */
	onMessageArrived(envelope) {
		let signed = signer.unpack(envelope.overlayFrom, envelope.data);
		if (!signed) {
			console.log('failed to unpack message: ' + JSON.stringify(envelope));
			return;
		}
		this.messageListeners.forEach(l => l.messageArrived(envelope, signed));
		if ('findvertical' === envelope.overlay) {
			this.send('verticalcandidate', envelope.overlayFrom, {level: signed.level});
		} else if ('verticalcandidate' === envelope.overlay) {
			if (signed.level >= this.verticals.length) {
				console.log('got candidate outside verticals network.');
			} else if (this.verticals[signed.level] != 'pending') {
				console.log('already had vertical at: ' + signed.level);
			} else {
				if (idhelper.goodEnough(this.localid.id, envelope.overlayFrom, signed.level)) {
					this.verticals[signed.level] = envelope.overlayFrom;
					this.connectTo(envelope.overlayFrom);
				}
			}
		} else if ('ringring' === envelope.overlay) {
			this.webrtc.start(true, envelope.overlayFrom, envelope.overlayFromInstance, new Signaller(this));
		} else if ('getflood' === envelope.overlay) {
			this.sendFloodReport(envelope.overlayFrom);
		} else if ('floodreport' === envelope.overlay) {
			if (this.flood.length < this.totalFloodSize()) {
				signed.flood.forEach(peerId => this.connectTo(peerId));
			} else {
				let maxDistance = idhelper.furthestDistance(this.localid.id, this.flood);
				signed.flood.forEach(floodCandidate => {
					if (!idhelper.contains(this.flood, floodCandidate)) {
						let distance = idhelper.distance(this.localid.id, floodCandidate);
						if (distance.compareTo(maxDistance) < 0) {
							this.connectTo(floodCandidate);
						}
					}
				});
			}
		} else if ('webrtc' === envelope.overlay) {
			this.webrtc.handleSignal(envelope.overlayFrom, envelope.overlayFromInstance, signed, new Signaller(this));
		} else if ('findsocket' === envelope.overlay) {
			if (this.websocket.ws && (this.websocket.ws.readyState == 0 || this.websocket.ws.readyState == 1)) {
				this.sendAround('findsocket', idhelper.parseBigInt10(signed.traveled));
			} else {
				this.websocket.connect({reconnect: true});
			}
		} else if ('checkforid' === envelope.overlay) {
			console.log('got a request if i am here');
			this.send('imhere', envelope.overlayFrom);
		} else if ('imhere' === envelope.overlay) {
			console.log('got response, confirming: ' + envelope.overlayFrom);
			this.websocket.confirm(envelope.overlayFrom);
		}
	}

	sendFloodReport(peerId) {
		this.send('floodreport', peerId, {flood: this.flood});
	}

	floodSize() {
		return this.FLOOD_SIZE;
	}

	totalFloodSize() {
		return this.floodSize() * 2 + 1;
	}

	addSubordinate(connection) {
		this.subordinates.push(connection.instanceId);
	}

	enterSubordinateMode(connection) {
		this.status.subordinateMode = true;
		this.websocket.disconnect();
	}

	stopCleaner() {
		this.cleaner.stop();
	}
	
	shutdown() {
		this.websocket.disconnect();
		this.webrtc.shutdown();
		this.cleaner.stop();
	}
}

class Signaller {
	constructor(overlay) {
		this.overlay = overlay;
	}
	setConnection(connection) {
		this.connection = connection;
	}
	send(message) {
		this.overlay.send('webrtc', this.connection.peerId, {message: message, timestamp: this.connection.timestamp, initiator: this.connection.initiator});
	}
	addConnection() {
		this.overlay.addConnection(this.connection);
	}
}

/**
 * Module for managing a p2p overlay network built on webrtc.
 * @exports overlay
 */
module.exports.Overlay = Overlay;

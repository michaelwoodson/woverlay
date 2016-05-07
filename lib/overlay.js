"use strict";

let WebRTC = require('./webrtc').WebRTC;
let WebSocketWrapper = require('./websocket').WebSocketWrapper;
let Cleaner = require('./cleaner').Cleaner;

let idhelper = require('./idhelper');
let signer = require('./signer')


class Overlay {
	constructor(localid, host) {
		this.verticals = [];
		this.flood = [];
		this.subordinates = [];
		this.messageListeners = [];
		this.connectionListeners = [];
		this.disconnectionListeners = [];
		this.pendingEnvelopes = [];
		this.status = {initialized: false, subordinateMode: false};
		this.localid = localid;
		this.webrtc  = new WebRTC(this.localid, this);
		this.websocket = new WebSocketWrapper(this, host);
		this.webrtc.listeners.push(() => this.onWebrtcChange());
		this.cleaner = new Cleaner(this);
		this.rings = new Set();
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
	static wrapIndex(index, length) {
		if (index < 0) {
			return length + index;
		} else if (index >= length) {
			return index - length;
		} else {
			return index;
		}
	}

	loadFlood(connections) {
		this.flood.length = 0;
		Overlay.makeFlood(connections, this.localid).forEach(c => this.flood.push(c));
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
			this.loadFlood(connections, this.localid);
			this.cleaner.checkFloodAndVerticals(false);
		}
	}

	addConnection(connection, bootstrap) {
		connection.golden = true;
		connection.overlay = true;
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
			this.pendingEnvelopes.forEach(e => {
				e.proxies = [this.localid.id];
				this.proxy(e);
			});
			this.pendingEnvelopes.length = 0;
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
	send(overlayAction, to, data, path) {
		let envelope = {};
		envelope.overlayFrom = this.localid.id;
		envelope.overlayFromInstance = this.localid.instanceId;
		envelope.overlayTo = to;
		envelope.action = 'overlay';
		envelope.overlay = overlayAction;
		envelope.proxies = [this.localid.id];
		envelope.data = signer.pack(data || {}, this.localid.key);
		if (path) {
			envelope.path = path;
		}
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
		this.augmentFlood(envelope.proxies);
		let to;
		// Check for direct connections to the target.
		let activeConnections = this.webrtc.getOpenConnections();
		activeConnections = activeConnections.filter(c => c.golden);
		let activeConnectionIds = activeConnections.map(c => c.peerId);
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
			// Check if the envelope has a path and use any connections from there.
			if (!to && envelope.path) {
				activeConnectionIds.filter(id => envelope.path.indexOf(id) >= 0 && !envelope.proxies.indexOf(id) >= 0).forEach(id => {
					to = this.filterRecipient(id, to, envelope);
				});
			}
			// Check for closest direct connection.
			if (!to) {
				let options = [...activeConnectionIds];
				while (!to && options.length) {
					let closest = idhelper.closest(envelope.overlayTo, options);
					to = this.filterRecipient(closest, to, envelope);
					if (!to) {
						idhelper.remove(closest, options);
					}
				}
			}
			// Final end run for small/forming networks, return to sender.
			//if (!to && envelope.overlayFrom != this.localid.id && this.flood.length < this.totalFloodSize() && this.flood.indexOf(envelope.from) >= 0) {
			if (!to && this.flood.length < this.totalFloodSize()) {
				if (this.webrtc.active(envelope.from)) {
					to = envelope.from;
				}
				//to = envelope.from;
			}
		}
		if (to) {
			//console.log('found proxy: ' + to);
			if (envelope.proxies.indexOf(this.localid.id) < 0) {
				envelope.proxies.push(this.localid.id);
			}
			envelope.to = to;
			this.webrtc.send(envelope);
		} else {
			if (envelope.retries) {
				envelope.retries++;
			} else {
				envelope.retries = 1;;
			}
			const RETRIES = 10;
			let hasPending = this.webrtc.connections.filter(c => !c.channel || c.channel.readyState == 'connecting').length;
			if (envelope.retries <= RETRIES || hasPending || !activeConnections.length) {
				this.pendingEnvelopes.push(envelope);
			} else {
				console.log(
`Failed to proxy: ${envelope.overlay} localid: ${idhelper.shortName(this.localid.id, false)}
  to: ${idhelper.shortName(envelope.overlayTo, false)} originalFrom: ${idhelper.shortName(envelope.overlayFrom, false)} from: ${idhelper.shortName(envelope.from, false)}
  proxies: ${envelope.proxies.map(id => idhelper.shortName(id, false))}
  verticals: ${this.verticals.map(id => idhelper.shortName(id, false))}
  flood: ${this.flood.map(id => idhelper.shortName(id, false))}
  cxs: ${this.webrtc.connections.length} readyState: ${this.webrtc.connections.map(c => !c.channel ? 'no channel' : c.channel.readyState)}
  active: ${activeConnectionIds.map(id => idhelper.shortName(id, false))}`
  				);
				console.log(`giving up, tried: ${envelope.retries} hasPending: ${hasPending}`);
				if (envelope.path) {
					console.log('had path: ' + idhelper.shortArray(envelope.path))
				}
			}
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
		this.webrtc.connections.filter(c => c.peerId != this.localid.id && c.golden).forEach(c => ids.push(c.peerId));
		ids.push(this.localid.id);
		return ids;
	}

	/**
	 * Get an array of ids that are currently connected.
	 * @private
	 */
	getPendingOrActiveIds() {
		let ids = [];
		this.webrtc.connections.filter(c => c.peerId != this.localid.id && c.overlay && (!c.channel || c.channel.readyState != 'closed')).forEach(c => ids.push(c.peerId));
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
		if (id != this.localid.id && !this.webrtc.connectionMap[id] && !this.rings.has(id)) {
			this.rings.add(id);
			this.send('ringring', id);
			setTimeout(() => this.rings.delete(id), 10 * 1000);
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
			this.webrtc.start(true, envelope.overlayFrom, envelope.overlayFromInstance, new Signaller(this, envelope.proxies));
		} else if ('getflood' === envelope.overlay) {
			this.send('floodreport', envelope.overlayFrom, {flood: this.targetFlood()});
		} else if ('floodreport' === envelope.overlay) {
			this.augmentFlood(signed.flood);
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

	augmentFlood(ids) {
		let potentialIds = this.getPendingOrActiveIds();
		ids.filter(id => potentialIds.indexOf(id) < 0).forEach(id => potentialIds.push(id));
		let idealFlood = Overlay.makeFlood(potentialIds, this.localid);
		idealFlood.forEach(id => this.connectTo(id));
	}
	
	targetFlood() {
		let ids = this.getPendingOrActiveIds();
		return Overlay.makeFlood(ids, this.localid);
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
		console.log('closing ws, subordinate mode');
		this.status.subordinateMode = true;
		this.websocket.disconnect();
	}

	stopCleaner() {
		this.cleaner.stop();
	}
	
	shutdown() {
		console.log('closing ws, shutdown');
		this.websocket.disconnect();
		this.webrtc.shutdown();
		this.cleaner.stop();
	}
	static makeFlood(connections, localid) {
		let flood = [];
		connections.sort();
		if (connections.length < Overlay.FLOOD_SIZE * 2 + 1) {
			flood = connections;
		} else {
			let myIndex = 0;
			for (let i = 0; i < connections.length; i++) {
				if (connections[i] == localid.id) {
					myIndex = i;
					break;
				}
			}
			for (let i = -Overlay.FLOOD_SIZE; i <= Overlay.FLOOD_SIZE; i++) {
				let index = Overlay.wrapIndex(myIndex + i, connections.length);
				flood.push(connections[index]);
			}
		}
		return flood;
	}
}

class Signaller {
	constructor(overlay, proxies) {
		this.overlay = overlay;
		this.proxies = proxies;
	}
	setConnection(connection) {
		this.connection = connection;
	}
	send(message) {
		this.overlay.send('webrtc', this.connection.peerId, {message: message, timestamp: this.connection.timestamp, initiator: this.connection.initiator}, this.proxies);
	}
	addConnection() {
		this.overlay.addConnection(this.connection);
	}
	isOverlay() {
		return true;
	}
}

Overlay.FLOOD_SIZE = 2;

/**
 * Module for managing a p2p overlay network built on webrtc.
 * @exports overlay
 */
module.exports.Overlay = Overlay;
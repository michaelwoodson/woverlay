'use strict';

let WebRTC = require('./webrtc').WebRTC;
let WebSocketWrapper = require('./websocket').WebSocketWrapper;

let DHT = require('./dht');
let Cleaner = require('./cleaner');

let idhelper = require('./idhelper');
let signer = require('./signer');


class Overlay {
	constructor(localid, host) {
		this.fingers = [];
		this.flood = [];
		this.subordinates = [];
		this.messageListeners = [];
		this.connectionListeners = [];
		this.disconnectionListeners = [];
		this.badnetListeners = [];
		this.nowebrtcListeners = [];
		this.pendingEnvelopes = [];
		this.status = {initialized: false, subordinateMode: false, badnet: false};
		this.localid = localid;
		this.webrtc  = new WebRTC(this.localid, this);
		this.websocket = new WebSocketWrapper(this, host);
		this.webrtc.listeners.push(() => this.onWebrtcChange());
		this.rings = new Set();
		this.cleaner = new Cleaner(this);
		this.dht = new DHT(this);
	}
	
	connect(config) {
		if (this.webrtc.nowebrtc) {
			this.nowebrtcListeners.forEach(l => l());
		} else {
			this.websocket.connect(config);
			// Need to find a better way to start, hack to keep from running when testing.
			this.cleaner.start();
		}
	}

	/**
	 * Store the data at the location of the given key in the dht.  To clear a value,
	 * put "null".
	 * @param {string} key The location to store the data.
	 * @param {object} data The data to store, will be stringified.
	 * @return {Promise} Successful if the data is put properly, fails if response times out.
	 */
	put(key, data) {
		return this.dht.put(key, data, this.localid.id);
	}
	
	/**
	 * Get the data stored at the given location.
	 * @param {string} key The location to get data from.
	 * @return {Promise} An object keyed by the ids of the owners with the corresponding data of the owner.
	 */
	get(key) {
		return this.dht.get(key);
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

	inFlood(id) {
		return this.flood.indexOf(id) >= 0 || this.targetFlood().indexOf(id) >= 0;
	}

	/**
	 * Update the overlay network when the webrtc connection state changed.
	 * This function is an event handler for webrtc state changes.
	 */
	onWebrtcChange() {
		let goldenIds = this.getGoldenIds();
		if (this.status.subordinateMode) {
			if (!goldenIds.indexOf(this.localid.id)) {
				//this.status.subordinateMode;
				//TODO: trigger reconnect?
			}
		} else {
			this.flood = Overlay.makeFlood(goldenIds, this.localid);
			this.cleaner.checkFloodAndFingers(false);
		}
	}

	addConnection(connection, bootstrap) {
		connection.golden = true;
		connection.overlay = true;
		this.onWebrtcChange();
		if (!this.status.subordinateMode) {
			if (this.status.initialized) {
				if (this.flood.length < this.totalFloodSize()) {
					this.flood.filter(peerId => peerId != this.localid.id && peerId != connection.peerId && this.webrtc.active(peerId)).forEach(peerId => {
						this.send('floodreport', peerId, {flood: this.targetFlood()});
					});
				}
			} else {
				this.status.initialized = true;
			}
			if (bootstrap) {
				bootstrap.fingers.forEach(id => this.connectTo(id));
				bootstrap.flood.forEach(id => this.connectTo(id));
			}
			this.drain();
			this.connectionListeners.forEach(l => l(connection.peerId));
		}
		this.webrtc.updateListeners();
	}

	drain() {
		let pendingClone = this.pendingEnvelopes.slice(0);
		this.pendingEnvelopes.length = 0;
		pendingClone.forEach(e => {
			e.proxies = [this.localid.id];
			this.proxy(e);
		});
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
		envelope.overlayFromTimestamp = this.localid.instanceTimestamp;
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
		envelope.overlayFromTimestamp = this.localid.instanceTimestamp;
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
	closed(connection) {
		let id = connection.peerId;
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
			if (connection.golden) {
				this.disconnectionListeners.forEach(l => l(id));
			}
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
				activeConnectionIds.filter(id => envelope.path.indexOf(id) >= 0 && envelope.proxies.indexOf(id) === -1).forEach(id => {
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
				envelope.retries = 1;
			}
			const RETRIES = 10;
			let hasPending = this.webrtc.connections.filter(c => !c.channel || c.channel.readyState == 'connecting').length;
			if (envelope.retries <= RETRIES || hasPending || !activeConnections.length) {
				this.pendingEnvelopes.push(envelope);
			} else {
				console.log(
`Failed to proxy: ${envelope.overlay} localid: ${idhelper.shortId(this.localid.id, false)}
  to: ${idhelper.shortId(envelope.overlayTo, false)} originalFrom: ${idhelper.shortId(envelope.overlayFrom, false)} from: ${idhelper.shortId(envelope.from, false)}
  proxies: ${envelope.proxies.map(id => idhelper.shortId(id, false))}`
				);
				console.log(`giving up, tried: ${envelope.retries} hasPending: ${hasPending}`);
				if (envelope.path) {
					console.log('had path: ' + idhelper.shortArray(envelope.path));
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
	 * Get an array of ids that are marked as golden (in use by the overlay).
	 * @private
	 */
	getGoldenIds() {
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
		if ('findfinger' === envelope.overlay) {
			this.send('fingercandidate', envelope.overlayFrom, {level: signed.level});
		} else if ('fingercandidate' === envelope.overlay) {
			if (signed.level >= this.fingers.length) {
				console.log('got candidate outside fingers network.');
			} else if (this.fingers[signed.level] != 'pending') {
				if (envelope.overlayFrom != this.fingers[signed.level]) {
					this.fingers[signed.level] = this.bestFinger(this.localid.id, signed.level, envelope.overlayFrom, this.fingers[signed.level]);
				}
			} else {
				if (idhelper.goodEnough(this.localid.id, envelope.overlayFrom, signed.level)) {
					this.fingers[signed.level] = envelope.overlayFrom;
					this.connectTo(envelope.overlayFrom);
				}
			}
		} else if ('ringring' === envelope.overlay) {
			this.webrtc.start(true, envelope.overlayFrom, envelope.overlayFromInstance, new OverlaySignaller(this, envelope.proxies));
		} else if ('getflood' === envelope.overlay) {
			this.send('floodreport', envelope.overlayFrom, {flood: this.targetFlood()});
		} else if ('floodreport' === envelope.overlay) {
			this.augmentFlood(signed.flood);
		} else if ('webrtc' === envelope.overlay) {
			this.webrtc.handleSignal(envelope.overlayFrom, envelope.overlayFromInstance, signed, new OverlaySignaller(this));
		} else if ('findsocket' === envelope.overlay) {
			if (this.status.subordinateMode) {
				console.log('hmm, subordinate mode...');
			}
			if (this.websocket.ws && (this.websocket.ws.readyState === WebSocket.CONNECTING || this.websocket.ws.readyState === WebSocket.OPEN)) {
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

	bestFinger(id, level, candidate1, candidate2) {
		let idealFinger = idhelper.getIdealFinger(id, level);
		return idhelper.closest(idealFinger, [candidate1, candidate2]);
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
		return 2;
	}

	totalFloodSize() {
		return 5;
	}

	inFloodRange(id) {
		let flood = this.targetFlood();
		if (flood.length < this.totalFloodSize()) {
			return true;
		} else {
			let leftBN = idhelper.getBigInt(flood[0]);
			let rightBN = idhelper.getBigInt(flood[flood.length - 1]);
			let idBN = idhelper.getBigInt(id);
			if (leftBN.compareTo(rightBN) < 0) {
				return leftBN.compareTo(idBN) <= 0 && rightBN.compareTo(idBN) >= 0;
			} else {
				return rightBN.compareTo(idBN) >= 0 || leftBN.compareTo(idBN) <= 0;
			}
		}
	}

	addSubordinate(connection) {
		this.subordinates.push(connection.instanceId.guid);
	}

	enterSubordinateMode() {
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
	badnet() {
		this.shutdown();
		this.status.badnet = true;
		this.badnetListeners.forEach(l => l());
		this.webrtc.updateListeners();
	}
	print() {
		console.log(
`localid: ${this.localid.id.substring(0,6)} ${this.localid.instanceId.guid.substring(0,6)}
  status: ${JSON.stringify(this.status)}
  ws: ${this.websocket.ws ? this.websocket.ws.readyState : 'N/A'}
  fingers: ${this.fingers.map(id => idhelper.shortId(id, false))}
  flood: ${this.flood.map(id => idhelper.shortId(id, false))}
  cxs: ${this.webrtc.connections.length} readyState: ${this.webrtc.connections.map(c => !c.channel ? 'no channel' : c.channel.readyState)}`
		);
	}
	printId() {
		this.localid.printNice();
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

class OverlaySignaller {
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

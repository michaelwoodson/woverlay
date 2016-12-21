'use strict';

let badapter = require('./badapter');
let configuration = require('./webrtc.config');

class WebRTC {
	constructor(localid, overlay) {
		this.listeners = [];
		this.connections = [];
		this.connectionMap = {};
		this.instanceMap = {};
		this.deadTimestamps = {};
		this.localid = localid;
		this.overlay = overlay;
		this.binaryMessageListeners = [];
		this.nowebrtc = badapter.nowebrtc;
		if (window && window.addEventListener) {
			window.addEventListener('beforeunload', () => this.sayBye());
		}
	}

	/**
	 * Start a webrtc connection with the given peer.
	 * @param {boolean} isInitiator Flag indicating if the connection is being
	 * initiated by this client or if the connection is being requested by
	 * someone else.
	 * @param {string} peerId The unique identifier of the peer to connect with.
	 * @param {object} signalingChannel A channel to use for establishing the
	 * webrtc connection.	If this is the first connection it should be a
	 * websocket, otherwise it is another peer connection to signal over the
	 * overlay network.	Should have a send(peerId, data) object that is called
	 * to send signaling messages.
	 */
	start(isInitiator, peerId, instanceId, signaller, timestamp, websocketProxy, websocketProxyInstance) {
		//console.log('start: ' + isInitiator + ' ts:' + timestamp + ' iid:' + instanceId);
		let existingConnection = this.getConnection(peerId, instanceId);
		if (peerId === 'pending') {
			console.log('not connecting to pending connection');
			return;
		}
		if (existingConnection) {
			//console.log(`asked to start but there is already a connection... ${existingConnection.pc.iceConnectionState} ${existingConnection.initiator} ${isInitiator}`);
			existingConnection.used = true;
			return;
		}
		if (peerId === this.localid.id && instanceId === this.localid.instanceId) {
			return;
		}
		let connection = {
			peerId: peerId,
			instanceId: instanceId,
			used: true, 
			usedByPeer: true, 
			initiator: isInitiator,
			timestamp: timestamp || Date.now(),
			websocketProxy : websocketProxy,
			websocketProxyInstance: websocketProxyInstance,
			golden: false,
			overlay: signaller.isOverlay(),
			lastUse: new Date(),
			closed: false
		};
		signaller.setConnection(connection);
		connection.signalingChannel = signaller;
		this.connections.push(connection);
		if (peerId === this.localid.id) {
			this.instanceMap[instanceId] = connection;
		} else {
			this.connectionMap[peerId] = connection;
		}
		connection.pc = new badapter.RTCPeerConnection(configuration);
		if (!isInitiator) {
			// setup chat on incoming data channel
			connection.pc.ondatachannel = (evt) => {
				connection.channel = evt.channel;
				this.setupChannel(connection);
			};
		}
		// send any ice candidates to the other peer
		connection.pc.onicecandidate = (evt) => {
			if (evt.candidate) {
				connection.signalingChannel.send({ 'candidate': evt.candidate }, connection.timestamp);
			}
		};
		// Some examples use this event to trigger connection.pc.createOffer, but this
		// doesn't work with node-webrtc, event never gets triggered.
		connection.pc.onnegotiationneeded = () => {
		};
		connection.pc.oniceconnectionstatechange = () => {
			if (connection.pc.iceConnectionState === 'failed' || connection.pc.iceConnectionState === 'closed') {
				this.removeConnection(connection);
			}
			this.updateListeners();
		};
		connection.pc.onidpassertionerror = () => console.log('error: onidpassertionerror');
		connection.pc.onidpvalidationerror = () => console.log('error: onidpvalidationerror');
		if (isInitiator) {
			// create data channel and setup chat
			connection.channel = connection.pc.createDataChannel('chat');
			this.setupChannel(connection);
			connection.pc.createOffer((desc) => {
				connection.pc.setLocalDescription(desc, () => {
					connection.signalingChannel.send({ 'sdp': connection.pc.localDescription}, timestamp);
				}, () => console.log('error: set local description'));
			}, () => console.log('error: create offer'));
		}
		return connection;
	}

	/**
	 * Called by the signalling channel when a signal message is received.
	 * @param {string} peerId The peer that sent the signal.
	 * @param {object} envelope The message that was sent.
	 * @param {object} adapter An adapter to send responses to the signal to.
	 */
	handleSignal(peerId, instanceId, envelope, signaller) {
		let connection = this.getConnection(peerId);
		if (this.deadTimestamps[envelope.timestamp]) {
			return;
		}
		if (!connection) {
			this.start(false, peerId, instanceId, signaller, envelope.timestamp, envelope.websocketProxy, envelope.websocketProxyInstance);
			connection = this.getConnection(peerId, instanceId);
		}
		if (connection.timestamp < envelope.timestamp) {
			this.disconnect(connection);
			connection = this.start(false, peerId, instanceId, signaller, envelope.timestamp);
		}

		if (envelope.timestamp != connection.timestamp) {
			// Do nothing.
		} else if (envelope.message.sdp) {
			connection.pc.setRemoteDescription(new badapter.RTCSessionDescription(envelope.message.sdp), () => {
				// if we received an offer, we need to answer
				if (connection.pc.remoteDescription.type == 'offer') {
					connection.pc.createAnswer((desc) => {
						connection.pc.setLocalDescription(desc, () => {
							connection.signalingChannel.send({ 'sdp': connection.pc.localDescription }, connection.timestamp);
						}, () => console.log('error: createAnswer'));
					}, () => console.log('error: onidpassertionerror'));
				}
			}, () => console.log('error: setRemoteDescription'));
		} else {
			if (envelope.message.candidate) {
				try {
					connection.pc.addIceCandidate(new badapter.RTCIceCandidate(envelope.message.candidate)).then({
					}).catch((e) => {
						console.log(`signalingState: ${connection.pc.signalingState} iceConnectionState: ${connection.pc.iceConnectionState} message: ${e}`);
						console.log(`failed to add ice candidate: ${e} connection: ${this.makeString(connection)}`);
						console.log(`overlay status: ${JSON.stringify(this.overlay.status)}`);
					});
				} catch (e) {
					console.log('glitched message: ' + JSON.stringify(envelope));
					console.log(`isOverlay: ${connection.signalingChannel.isOverlay()} signalingState: ${connection.pc.signalingState} iceConnectionState: ${connection.pc.iceConnectionState} message: ${e.message}`);
				}
			} else {
				console.log('unrecognized webrtc message: ' + JSON.stringify(envelope));
			}
		}
	}

	makeString(connection) {
		return JSON.stringify(connection, [
			'peerId',
			'instanceId',
			'used',
			'usedByPeer',
			'initiator',
			'timestamp',
			'golden',
			'overlay',
			'lastUse',
			'closed'
		]);
	}

	/**
	 * Filters connections for those that have a working channel.
	 */
	getOpenConnections() {
		return this.connections.filter(c => this.active(c.peerId));
	}

	active(id) {
		let connection = this.getConnection(id);
		return connection && connection.channel && connection.channel.readyState === 'open';
	}

	/**
	 * Configure the newly created channel associated with the connection.
	 * Adds message handlers and notifies listeners about the newly created
	 * channel.
	 * @private
	 * @param {object} connection The connection with a newly created channel
	 * to set up.
	 */
	setupChannel(connection) {
		connection.channel.binaryType = 'arraybuffer';
		connection.channel.onmessage = (event) => {
			if (typeof event.data === 'string') {
				if (event.data.length === 0) {
					console.log('no data, ff bug?');
				} else {
					let envelope = JSON.parse(event.data);
					if ('markUsed' === envelope.action) {
						connection.usedByPeer = true;
					} else if ('markUnused' === envelope.action) {
						connection.usedByPeer = false;
						if (!connection.used) {
							this.disconnect(connection);
							//console.log('disconnecting');
						}
					} else if ('byebye' === envelope.action) {
						this.disconnect(connection);
					} else if ('overlay' === envelope.action) {
						this.overlay.onMessage(envelope);
					}
				}
			} else {
				this.binaryMessageListeners.forEach(l => l(connection.peerId, event.data));
			}
		};
		connection.channel.onclose = () => {
			this.removeConnection(connection);
		};
		let openHandler = () => {
			connection.signalingChannel.addConnection();
			this.updateListeners();
		};
		if (connection.channel.readyState === 'open') {
			openHandler();
		} else {
			connection.channel.onopen = () => {
				openHandler();
			};
		}
		connection.channel.onerror = () => {
			console.log('channel error');
		};
	}

	sayBye() {
		this.connections.forEach(c => this.send({to: c.peerId, action: 'byebye'}));
	}

	/**
	 * Send a message view webrtc.
	 * @param {object} envelope A message with a "to" attribute set as the id
	 * of the connection to send to.
	 */
	send(envelope) {
		let connection = this.getConnection(envelope.to, envelope.instanceId);
		if (connection && connection.channel) {
			if (connection.channel.readyState === 'open') {
				envelope.from = this.localid.id;
				envelope.timestamp = connection.timestamp;
				let stringified = JSON.stringify(envelope);
				try {
					connection.lastUse = new Date();
					connection.channel.send(stringified);
				} catch (e) {
					console.log(`failed to send to: ${envelope.to} closed: ${connection.closed} iceState: ${connection.pc.iceConnectionState} readyState: ${connection.channel.readyState} signalingState: ${connection.pc.signalingState} msg: ${e.message}`);
				}
			} else {
				console.log('cannot send: ' + connection.channel.readyState + ' ' + JSON.stringify(envelope));
			}
		} else {
			console.log('no connection to send to: ' + envelope.to);
		}
	}

	/**
	 * Send raw binary data to the given peer.  There must be a direct connection
	 * to the peer.
	 */
	sendRaw(peerId, binaryData) {
		let connection = this.getConnection(peerId);
		if (connection && connection.channel) {
			if (connection.channel.readyState === 'open') {
				connection.channel.send(binaryData);
			} else {
				console.log('cannot send: ' + connection.channel.readyState + ' ' + peerId);
			}
		} else {
			console.log('no connection to send to: ' + peerId);
		}
	}

	/**
	 * Mark the connection as being used.	This will prevent the connection from being dropped
	 * and ensure it will be used in the flood network if the network is shrinking.
	 */
	markUsed(id) {
		let connection = this.getConnection(id);
		if (connection) {
			if (!connection.used) {
				connection.used = true;
				if (!connection.used) {
					this.send({to: id, action: 'markUsed'});
				}
			}
		}
	}

	/**
	 * Mark the connection as no longer used.	If the peer isn't using
	 * the connection it will immediately be disconnected, otherwise
	 * the peer will be notified that the connection is no longer used
	 * on this end.
	 */
	markUnused(id) {
		let connection = this.getConnection(id);
		if (connection) {
			if (connection.usedByPeer) {
				if (connection.used) {
					connection.used = false;
					this.send({to: id, action: 'markUnused'});
				}
			} else {
				this.disconnect(connection);
				console.log('unused disconnect');
			}
		}
	}

	/**
	 * Called internally when the network state has changed to update
	 * all the change listeners.
	 * @private
	 */
	updateListeners() {
		this.listeners.forEach(l => l());
	}

	setConnections(connections) {
		this.connections = connections;
	}

	getConnection(peerId, instanceId) {
		if (peerId === this.localid.id && instanceId) {
			return this.instanceMap[instanceId];
		} else {
			return this.connectionMap[peerId];
		}
	}

	/**
	 * Remove the given connection.	Called when a disconnect is detected
	 * internally.
	 * @private
	 * @param {object} connection The connection to remove.
	 */
	removeConnection(connection) {
		this.deadTimestamps[connection.timestamp] = connection.timestamp;
		let index = this.connections.indexOf(connection);
		if (index != -1) {
			this.connections.splice(index, 1);
		}
		if (this.connectionMap[connection.peerId] == connection) {
			delete this.connectionMap[connection.peerId];
		}
		if (this.instanceMap[connection.instanceId] == connection) {
			delete this.instanceMap[connection.instanceId];
		}
		this.overlay.closed(connection);
		this.updateListeners();
	}

	/**
	 * Shutdown the peer connection and channel associated with the given id.
	 * @private
	 * @param {object} connection The connection to shutdown.
	 */
	disconnect(connection) {
		if (connection) {
			connection.closed = true;
			if (connection.channel) {
				try {
					connection.channel.close();
				} catch (e) {
					console.log('failed to close channel: ' + e.message);
				}
			}
			if (connection.pc && connection.pc.signalingState != 'closed') {
				try {
					connection.pc.close();
				} catch (e) {
					console.log('failed to close connection: ' + e.message);
				}
			}
			this.removeConnection(connection);
		}
	}

	/**
	 * Close all connections.
	 */
	shutdown() {
		for (let key in this.connectionMap) {
			this.disconnect(this.connectionMap[key]);
		}
		for (let key in this.instanceMap) {
			this.disconnect(this.instanceMap[key]);
		}
	}
}

/**
 * A module for handling the set up of webrtc data channels.
 * @exports webrtc
 */
module.exports.WebRTC = WebRTC;

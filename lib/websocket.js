"use strict";

let signer = require('./signer');

class WebSocketWrapper {
	constructor(overlay, host) {
		this.localid = overlay.localid;
		this.overlay = overlay;
		this.webrtc = overlay.webrtc;
		this.probationFlag = true;
		this.blockCallback = null;
		this.onNetworkUpdate = onNetworkUpdate;
		this.connectInfoMap = {};
		this.host = host;
		if (!host && typeof location !== 'undefined') {
			this.host = location.origin.replace(/^http/, 'ws')
		}
	}
	connect(config) {
		if (!config) {
			config = {reconnect: false};
		}
		let WS = WebSocket;
		this.ws = new WS(this.host);
		this.ws.onmessage = (event) => {
			 this.handleMessage(event);
		}

		this.ws.onerror = (event) => {
			console.log('client: ws error!: ' + JSON.stringify(event) + ' host: ' + this.host);
		}

		this.ws.onopen = () => {
			this.probationFlag = true;
			let message = {
				action: config.reconnect ? 'reconnect' : 'bootstrap',
				from: this.localid.id,
				fromInstance: this.localid.instanceId
			};
			let packed = signer.pack(message, this.localid.key);
			packed.verifyId = this.localid.id;
			this.ws.send(JSON.stringify(packed));
			this.onNetworkUpdate();
			if (this.blockCallback) {
				this.sendGetBlock();
			}
		}
		this.ws.onclose = () => {
			this.ws = null;
			this.onNetworkUpdate();
		}
		this.overlay.messageListeners.push(new OverlayMessageListener(this));
	}
	confirm(id) {
		this.ws.send(JSON.stringify({
			from: this.localid.id,
			fromInstance: this.localid.instanceId,
			confirmed: id,
			action: 'confirm'
		}));
	}
	disconnect() {
		if (this.ws) {
			try {
				this.ws.close();
			} catch (e) {
				console.log('Failed to close: ' + e);
			}
		}
	}

	send(to, toInstance, message, data) {
		let messageToSend = JSON.stringify({
			to: to,
			toInstance: toInstance,
			from: this.localid.id,
			fromInstance: this.localid.instanceId,
			message: message,
			data: data
		});
		this.ws.send(messageToSend);
	}

	getBlock(callback) {
		this.blockCallback = callback;
		if (this.ws && this.ws.readyState === 1) {
			this.sendGetBlock();
		}
	}

	sendGetBlock() {
		this.ws.send(JSON.stringify({action: 'getblock'}));
	}

	/**
	 * Event handler for messages from the websocket.
	 * @param {object} evt See the websocket api.
	 */
	handleMessage(event) {
		let envelope = JSON.parse(event.data);
		//console.log(event.data);
		if (envelope.action && envelope.action === 'bootstrap') {
			this.overlay.sendToClosest('websocket.areyouthere', envelope.from, {
				wsFrom: envelope.from,
				wsFromInstance: envelope.fromInstance
			});
		} else if (envelope.action && envelope.action === 'findsocket') {
			this.overlay.sendAround('findsocket');
		} else if (envelope.action && envelope.action === 'blocktime') {
			this.blockCallback(envelope);
		} else if (envelope.message === 'accepted') {
			if (this.probationFlag) {
				this.probationFlag = false;
				//console.log('initiation disconnect');
				this.webrtc.disconnect(this.webrtc.getConnection(envelope.from, envelope.fromInstance));
				this.send(envelope.from, envelope.fromInstance, 'youinitiate');
			} else {
				//console.log('confirmed via accepted');
				this.confirm(envelope.from);
				this.overlay.addConnection(this.webrtc.getConnection(envelope.from, envelope.fromInstance), envelope.data);
				this.send(envelope.from, envelope.fromInstance, 'golden', this.connectInfoMap[envelope.from + envelope.fromInstance]);
			}
		} else if (envelope.message === 'notaccepted') {
			this.probationFlag = false;
			//console.log('not accepted disconnect');
			this.webrtc.disconnect(this.webrtc.getConnection(envelope.from, envelope.fromInstance));
			this.send(envelope.from, envelope.fromInstance, 'youinitiate');
		} else if (envelope.message === 'youinitiate') {
			//console.log('you initiate disconnect');
			this.probationFlag = false;
			this.webrtc.disconnect(this.webrtc.getConnection(envelope.from, envelope.fromInstance));
			this.webrtc.start(true, envelope.from, envelope.fromInstance, new Signaller(this));
		} else if (envelope.message === 'golden') {
			//console.log('confirmed via golden');
			this.confirm(envelope.from);
			this.overlay.addConnection(this.webrtc.getConnection(envelope.from, envelope.fromInstance), envelope.data);
		} else if (envelope.action && envelope.action === 'checkforid') {
			this.overlay.send('checkforid', envelope.id);
		} else {
			if (envelope.overlayTo) {
				this.overlay.send('websocket.webrtcreceive', envelope.overlayTo, envelope);
			} else {
				this.webrtc.handleSignal(envelope.from, envelope.fromInstance, envelope, new Signaller(this));
			}
		}
	}

	addConnection(connection) {
		if (connection.peerId === this.localid.id) {
			if (connection.instanceId > this.localid.instanceId) {
				console.log('add subordinate');
				this.overlay.addSubordinate(connection);
			} else {
				console.log('enter subordinate mode');
				this.overlay.enterSubordinateMode(connection);
			}
		} else {
			if (!connection.initiator) {
				this.send(
					connection.peerId,
					connection.instanceId,
					this.probationFlag ? 'notaccepted' : 'accepted',
					this.connectInfoMap[connection.peerId + connection.instanceId]
				);
			}
		}
	}
}

class OverlayMessageListener {
	constructor(websocket) {
		this.websocket = websocket;
	}
	messageArrived(envelope, signed) {
		if ('websocket.areyouthere' === envelope.overlay) {
			if (envelope.overlayToClosest === this.websocket.localid.id) {
				this.websocket.webrtc.start(
					true,
					signed.wsFrom,
					signed.wsFromInstance,
					new OverlaySignaller(envelope.overlayFrom, this.websocket)
				);
			} else {
				this.websocket.overlay.send('websocket.nothere', envelope.overlayFrom, {
					wsFrom: signed.wsFrom,
					wsFromInstance: signed.wsFromInstance,
					flood: this.websocket.overlay.targetFlood(),
					verticals: this.websocket.overlay.verticals
				});
			}
		} else if ('websocket.nothere' === envelope.overlay) {
			this.websocket.connectInfoMap[signed.wsFrom + signed.wsFromInstance] = signed;
			this.websocket.webrtc.start(true, signed.wsFrom, signed.wsFromInstance, new Signaller(this.websocket));
		} else if ('websocket.proxywebrtc' === envelope.overlay) {
			signed.websocketProxy = this.websocket.localid.id;
			signed.websocketProxyInstance = this.websocket.localid.instanceId;
			this.websocket.ws.send(JSON.stringify(signed));
		} else if ('websocket.webrtcreceive' === envelope.overlay) {
			// Note: the signaller should never be used, pass null instead?
			this.websocket.webrtc.handleSignal(signed.from, signed.fromInstance, signed, new OverlaySignaller(envelope.overlayFrom, this.websocket));
		}
	}
}

class OverlaySignaller {
	constructor(proxyId, websocket) {
		this.proxyId = proxyId;
		this.websocket = websocket;
	}
	setConnection(connection) {
		this.connection = connection;
	}
	send(message) {
		let messageToSend = {
			to: this.connection.peerId,
			toInstance: this.connection.instanceId,
			from: this.websocket.localid.id,
			fromInstance: this.websocket.localid.instanceId,
			timestamp: this.connection.timestamp,
			message: message
		};
		this.websocket.overlay.send('websocket.proxywebrtc', this.proxyId, messageToSend);
	}
	addConnection() {
		this.websocket.addConnection(this.connection);
	}
	isOverlay() {
		return false;
	}
}

class Signaller {
	constructor(websocket) {
		this.websocket = websocket;
	}
	setConnection(connection) {
		this.connection = connection;
	}
	send(message) {
		let messageToSend = {
			from: this.websocket.localid.id,
			fromInstance: this.websocket.localid.instanceId,
			timestamp: this.connection.timestamp,
			message: message
		};
		if (this.connection.websocketProxy) {
			messageToSend.to = this.connection.websocketProxy;
			messageToSend.toInstance = this.connection.websocketProxyInstance;
			messageToSend.overlayTo = this.connection.peerId;
		} else {
			messageToSend.to = this.connection.peerId;
			messageToSend.toInstance = this.connection.instanceId;
		}
		let messageJson = JSON.stringify(messageToSend);
		this.websocket.ws.send(messageJson);
	}
	addConnection() {
		this.websocket.addConnection(this.connection);
	}
	isOverlay() {
		return false;
	}
}

/**
 * Called when the websocket connection state changes.	Replace to update
 * the user interface when the websocket state changes.
 */
function onNetworkUpdate() {
}

module.exports.WebSocketWrapper = WebSocketWrapper;
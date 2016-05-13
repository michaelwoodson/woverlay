"use strict"

const SOCKET_TIMEOUT = 1200;

let signer = require('./signer');
let WebSocketServer = require('ws').Server;
let http = require('http');
let express = require('express');
let compression = require('compression');

let MAX_SOCKETS = 10;
let nextIndex = 0;
let promoted = 0;


module.exports.shutdown = shutdown;
module.exports.status = {};
module.exports.startup = startup;
module.exports.addWSListener = addWSListener;
module.exports.send = send;

let status = module.exports.status;
let app;
let server;
let wss;

let timedOut = 0;

let listeners = new Map();

function startup(publicDir, p) {
	app = express();
	let port = p || process.env.PORT || 5000;

	app.use(compression({filter: (req, res) => {
		return compression.filter(req,res) || req.path.endsWith('.data') || req.path.endsWith('.mem');
	}}));
	app.use(express.static(publicDir || __dirname + '/public/'));
	server = http.createServer(app);
	server.listen(port);
	wss = new WebSocketServer({server: server});

	status.socketMap = {};
	status.subordinateSocketMap = {};
	status.verifiedSocketHolder = {nextIndex: 0, sockets:[]};
	status.probationSocketHolder = {nextIndex: 0, sockets:[]};
	status.findMoreSocketsMode = false;
	status.verifiedCount = 0;

	console.log('http server listening on %d', port);

	showStatus();

	wss.on('connection', function connectionHandler(ws) {
		ws.confirmers = new Set();
		status.probationSocketHolder.sockets.push(ws);
		ws.onmessage= function onmessage(event) {
			let data = JSON.parse(event.data);
			let ws2;
			if ('verifyId' in data) {
				data = signer.unpack(data.verifyId, data);
			}
			if (listeners.has(data.action)) {
				listeners.get(data.action)(ws);
			} else if (data.action === 'bootstrap' || data.action === 'reconnect') {
				ws.id = data.from;
				ws.instanceId = data.fromInstance;
				if (alreadyConnected(data)) {
					console.log('already connected');
					// Will have till the timeout to connect. (~10 seconds)
					removeSocket(ws);
					status.subordinateSocketMap[data.fromInstance] = ws;
					ws.subordinate = true;
					ws2 = status.socketMap[data.from];
					send(ws2, JSON.stringify(data));
				}  else {
					status.socketMap[data.from] = ws;
					if (data.action === 'bootstrap') {
						ws2 = getNot(status.verifiedSocketHolder, ws);
						if (!ws2) {
							ws2 = getNot(status.probationSocketHolder, ws);
							if (ws2) {
								ws2.confirmers.add(ws.id);
							}
						}
						if (ws2) {
							ws.confirmers.add(ws2.id);
							send(ws2, JSON.stringify(data));
						}
					} else if (data.action === 'reconnect') {
						if (status.verifiedSocketHolder.sockets.length > 0 && status.verifiedSocketHolder.sockets.length < MAX_SOCKETS) {
							console.log('sending findsocket request');
							ws.confirmers.add(status.verifiedSocketHolder.sockets[0].id);
							send(status.verifiedSocketHolder.sockets[0], JSON.stringify({action: 'checkforid', id: data.from}));
						}
					}
				}
			} else if (data.action === 'confirm') {
				let confirmedWs = status.socketMap[data.confirmed];
				if (confirmedWs && status.probationSocketHolder.sockets.indexOf(confirmedWs) >= 0 && confirmedWs.confirmers.has(data.from)) {
					removeFromHolder(confirmedWs, status.probationSocketHolder);
					if (status.verifiedSocketHolder.sockets.length >= MAX_SOCKETS) {
						removeSocket(status.verifiedSocketHolder.sockets[0]);
					}
					promoted++;
					//console.log('PROMOTED SOMEONE!');
					status.verifiedSocketHolder.sockets.push(confirmedWs);
					status.verifiedCount++;
				}
			} else if (data.to && ws.id) {
				ws2 = status.socketMap[data.to];
				if (ws2 && ws.id == ws2.id && ws2.instanceId == ws.instanceId) {
					ws2 = status.subordinateSocketMap[data.toInstance];
				}
				if (ws2) {
					send(ws2, event.data);
				} else {
					console.log('not found: ' + data.to);
					console.log('not found data: ' + event.data);
				}
			} else {
				console.log('weird message: ' + JSON.stringify(data));
				removeSocket(ws);
			}
		};

		ws.onerror = function wserror(event) {
			console.log('server: ws error!: ' + event.data);
		}

		ws.on('close', function closeSocket() {
			removeSocket(ws);
			if (!status.findMoreSocketsMode && belowMaxSockets()) {
				status.findMoreSocketsMode = true;
				findMoreSockets();
			}
		});
	});
}

function addWSListener(event, listener) {
	listeners.set(event, listener);
}

function alreadyConnected(data) {
	return data.from in status.socketMap && data.fromInstance != status.socketMap[data.from].instanceId;
}

function removeFromHolder(ws, socketHolder) {
	let index = socketHolder.sockets.indexOf(ws);
	if (index != -1) {
		socketHolder.sockets.splice(index, 1);
		if (socketHolder.nextIndex > index) {
			socketHolder.nextIndex--;
		}
	}
}

function removeSocket(ws) {
	removeFromHolder(ws, status.verifiedSocketHolder);
	removeFromHolder(ws, status.probationSocketHolder);
	if (ws.readyState === 2 || ws.readyState === 3) {
		removeFromMaps(ws);
	} else {
		setTimeout(function timeoutSocket() {
			timedOut++;
			removeFromMaps(ws);
			try {
				ws.close();
			} catch (error) {
				console.log('failed to close socket ' + error.message);
			}
		}, SOCKET_TIMEOUT * 1000).unref();
	}
}

function removeFromMaps(ws) {
	if (ws.id && status.socketMap[ws.id] == ws) {
		delete status.socketMap[ws.id];
	}
	if (ws.instanceId && ws.instanceId in status.subordinateSocketMap && status.subordinateSocketMap[ws.instanceId] == ws) {
		delete status.subordinateSocketMap[ws.instanceId];
	}
}

function getNot(socketHolder, ws) {
	for (let counter = 0; counter < socketHolder.sockets.length; counter++) {
		if (socketHolder.nextIndex >= socketHolder.sockets.length) {
			socketHolder.nextIndex = 0;
		}
		let ws2 = socketHolder.sockets[socketHolder.nextIndex++];
		if (ws != ws2) {
			return ws2;
		}
	}
}

function findMoreSockets() {
	if (belowMaxSockets()) {
		console.log('sending findsocket request');
		send(status.verifiedSocketHolder.sockets[0], JSON.stringify({action: 'findsocket'}));
		//setTimeout(findMoreSockets, 5 * 1000).unref();
	} else {
		status.findMoreSocketsMode = false;
	}
}

function belowMaxSockets() {
	return status.verifiedSocketHolder.sockets.length > 0 && status.verifiedSocketHolder.sockets.length < MAX_SOCKETS;
}

function send(ws, data) {
	try {
		ws.send(data);
	} catch (error) {
		console.log('Server: Failed to send: ' + data);
	}
}

function showStatus() {
	console.log(`Probation: ${status.probationSocketHolder.sockets.length} Verified: ${status.verifiedSocketHolder.sockets.length} Promoted: ${promoted} Timed out: ${timedOut}`);
	setTimeout(showStatus, 10 * 1000).unref();
}

function shutdown() {
	server.close();
	wss.close();
}

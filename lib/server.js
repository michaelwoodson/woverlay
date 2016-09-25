'use strict';

const SOCKET_TIMEOUT = 1200;

let signer = require('./signer');
let WebSocketServer = require('ws').Server;
let http = require('http');
let express = require('express');
let compression = require('compression');

let MAX_SOCKETS = 10;

let promoted = 0;
let badnet = 0;
let timedOut = 0;

let probationTimeout = 20;

module.exports.shutdown = shutdown;
module.exports.status = {};
module.exports.startup = startup;
module.exports.addWSListener = addWSListener;
module.exports.setProbationTimeout = setProbationTimeout;
module.exports.send = send;

let serverStatus = module.exports.status;
let app;
let server;
let wss;

let listeners = new Map();

function startup(publicDir, p) {
	app = express();
	module.exports.app = app;
	let port = p || process.env.PORT || 5000;

	app.use(compression({filter: (req, res) => {
		return compression.filter(req,res) || req.path.endsWith('.data') || req.path.endsWith('.mem');
	}}));
	app.use(express.static(publicDir || __dirname + '/public/'));
	server = http.createServer(app);
	server.listen(port);
	wss = new WebSocketServer({server: server});

	serverStatus.socketMap = {};
	serverStatus.subordinateSocketMap = {};
	serverStatus.verifiedSocketHolder = {nextIndex: 0, sockets:[]};
	serverStatus.probationSocketHolder = {nextIndex: 0, sockets:[]};
	serverStatus.findMoreSocketsMode = false;
	serverStatus.verifiedCount = 0;

	console.log('http server listening on %d', port);

	showStatus();

	wss.on('connection', function connectionHandler(ws) {
		ws.confirmers = new Set();
		serverStatus.probationSocketHolder.sockets.push(ws);
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
					serverStatus.subordinateSocketMap[data.fromInstance] = ws;
					ws.subordinate = true;
					ws2 = serverStatus.socketMap[data.from];
					send(ws2, JSON.stringify(data));
				}  else {
					serverStatus.socketMap[data.from] = ws;
					if (data.action === 'bootstrap') {
						ws2 = getNot(serverStatus.verifiedSocketHolder, ws);
						let golden = true;
						if (!ws2) {
							golden = false;
							ws2 = getNot(serverStatus.probationSocketHolder, ws);
							if (ws2) {
								ws2.confirmers.add(ws.id);
							}
						}
						if (ws2) {
							ws.confirmers.add(ws2.id);
							send(ws2, JSON.stringify(data));
							if (golden) {
								setTimeout(() => {
									if (serverStatus.probationSocketHolder.sockets.includes(ws)) {
										console.log('badnet ' + ws.id);
										send(ws, JSON.stringify({action: 'badnet'}));
										badnet++;
									}
								}, probationTimeout * 1000);
							}
						}
					} else if (data.action === 'reconnect') {
						if (serverStatus.verifiedSocketHolder.sockets.length > 0 && serverStatus.verifiedSocketHolder.sockets.length < MAX_SOCKETS) {
							console.log('sending findsocket request');
							ws.confirmers.add(serverStatus.verifiedSocketHolder.sockets[0].id);
							send(serverStatus.verifiedSocketHolder.sockets[0], JSON.stringify({action: 'checkforid', id: data.from}));
						}
					}
				}
			} else if (data.action === 'confirm') {
				let confirmedWs = serverStatus.socketMap[data.confirmed];
				if (confirmedWs && serverStatus.probationSocketHolder.sockets.indexOf(confirmedWs) >= 0 && confirmedWs.confirmers.has(data.from)) {
					removeFromHolder(confirmedWs, serverStatus.probationSocketHolder);
					if (serverStatus.verifiedSocketHolder.sockets.length >= MAX_SOCKETS) {
						removeSocket(serverStatus.verifiedSocketHolder.sockets[0]);
					}
					promoted++;
					//console.log('PROMOTED SOMEONE!');
					serverStatus.verifiedSocketHolder.sockets.push(confirmedWs);
					serverStatus.verifiedCount++;
				}
			} else if (data.to && ws.id) {
				ws2 = serverStatus.socketMap[data.to];
				if (ws2 && ws.id == ws2.id && ws2.instanceId == ws.instanceId) {
					ws2 = serverStatus.subordinateSocketMap[data.toInstance];
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
		};

		ws.on('close', function closeSocket() {
			removeSocket(ws);
			if (!serverStatus.findMoreSocketsMode && belowMaxSockets()) {
				serverStatus.findMoreSocketsMode = true;
				findMoreSockets();
			}
		});
	});
}

function addWSListener(event, listener) {
	listeners.set(event, listener);
}

function alreadyConnected(data) {
	return data.from in serverStatus.socketMap && data.fromInstance != serverStatus.socketMap[data.from].instanceId;
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
	removeFromHolder(ws, serverStatus.verifiedSocketHolder);
	removeFromHolder(ws, serverStatus.probationSocketHolder);
	if (ws.readyState === 2 || ws.readyState === 3) {
		removeFromMaps(ws);
	} else {
		setTimeout(function timeoutSocket() {
			timedOut++;
			removeFromMaps(ws);
			try {
				ws.send({action: 'close'});
			} catch (error) {
				console.log('failed to close socket ' + error.message);
			}
		}, SOCKET_TIMEOUT * 1000).unref();
	}
}

function removeFromMaps(ws) {
	if (ws.id && serverStatus.socketMap[ws.id] == ws) {
		delete serverStatus.socketMap[ws.id];
	}
	if (ws.instanceId && ws.instanceId in serverStatus.subordinateSocketMap && serverStatus.subordinateSocketMap[ws.instanceId] == ws) {
		delete serverStatus.subordinateSocketMap[ws.instanceId];
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
		send(serverStatus.verifiedSocketHolder.sockets[0], JSON.stringify({action: 'findsocket'}));
		//setTimeout(findMoreSockets, 5 * 1000).unref();
	} else {
		serverStatus.findMoreSocketsMode = false;
	}
}

function belowMaxSockets() {
	return serverStatus.verifiedSocketHolder.sockets.length > 0 && serverStatus.verifiedSocketHolder.sockets.length < MAX_SOCKETS;
}

function send(ws, data) {
	try {
		ws.send(data);
	} catch (error) {
		console.log('Server: Failed to send: ' + data);
	}
}

function setProbationTimeout(timeout) {
	probationTimeout = timeout;
}

function showStatus() {
	console.log(`Probation: ${serverStatus.probationSocketHolder.sockets.length} Verified: ${serverStatus.verifiedSocketHolder.sockets.length} Promoted: ${promoted} Timed out: ${timedOut} Bad net: ${badnet}`);
	setTimeout(showStatus, 10 * 1000).unref();
}

function shutdown() {
	server.close();
	wss.close();
}

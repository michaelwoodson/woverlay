'use strict';

let intTest = require('./lib/int.test');
let waitFor = require('./lib/wait.for');

const PORT = 5002;
const URL = 'ws://localhost:' + PORT + '/';

let server = intTest(__filename, PORT, () => {
	let test = require('tape');
	let LocalID = require('../lib/localid').LocalID;
	let Overlay = require('../lib/overlay').Overlay;

	test('restart server', function(t) {
		let localid = new LocalID(true);
		let overlay = makeOverlay(localid);
		waitFor(() => overlay.websocket.ws && overlay.websocket.ws.readyState === 1)
		.then(() => {
			t.pass('websocket connected');
			let controlSocket = new WebSocket(URL);
			controlSocket.onopen = () => {
				controlSocket.send(JSON.stringify({action: 'restart'}));
			};
			return waitFor(() => !overlay.websocket.ws || overlay.websocket.ws.readyState !== 1);
		}).then(() => {
			t.pass('websocket disconnected');
			return waitFor(() => overlay.websocket.ws && overlay.websocket.ws.readyState === 1);
		}).then(() => { 
			t.pass('websocket reconnected');
			t.end();
		}).catch(() => {
			t.fail('failed making subordinates');
			t.end();
		});
	});
	function makeOverlay(localid) {
		let overlay = new Overlay(localid, URL);
		overlay.connect();
		return overlay;
	}
});

if (server) {
	server.addWSListener('restart', () => {
		server.shutdown();
		setTimeout(() => server.startup(), 3000);
	});
}

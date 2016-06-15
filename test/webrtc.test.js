'use strict';

let test = require('tape');
let WebRTC = require('../lib/webrtc').WebRTC;
let webrtc = new WebRTC({}, {});

test('open connections', function(t) {
	webrtc.setConnections([
		{peerId: 'connected', channel: {readyState: 'open'}},
		{peerId: 'notconnected', channel: {readyState: 'closed'}}
	]);
	webrtc.connectionMap.connected = webrtc.connections[0];
	webrtc.connectionMap.notconnected = webrtc.connections[1];
	let connections = webrtc.getOpenConnections();
	t.ok(connections.length == 1);
	t.ok(connections[0].peerId == 'connected');
	t.end();
});

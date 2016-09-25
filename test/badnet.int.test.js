'use strict';

let intTest = require('./lib/int.test');
let waitFor = require('./lib/wait.for');

const PORT = 5006;
intTest(__filename, PORT, () => {
	let test = require('tape');

	let idJsonArray = require('./lib/test.localids.25');
	let LocalID = require('../lib/localid').LocalID;
	let Overlay = require('../lib/overlay').Overlay;
	let localid2 = new LocalID(false, null, idJsonArray[2]);

	let o0 = makeOverlay(new LocalID(false, null, idJsonArray[0]));
	let o1 = makeOverlay(new LocalID(false, null, idJsonArray[1]));

	test('badnet', function(t) {
		const WAIT_TIME = 60;
		waitFor(()=> o0.flood.length == 2, WAIT_TIME)
		.then(() => {
			t.pass('first golden');
			return waitFor(() => o1.flood.length == 2, WAIT_TIME);
		}).then(() => {
			t.pass('second golden');
			let o2 = makeOverlay(localid2);
			return waitFor(() => o2.status.badnet, WAIT_TIME);
		}).then(() => { 
			t.pass('got badnet flag');
			t.end();
		}).catch((e) => {
			console.log('failed: ' + e);
			t.fail('failed waiting for badnet');
			t.end();
		});
	});

	function makeOverlay(localid) {
		let overlay = new Overlay(localid, 'ws://localhost:' + PORT + '/');
		overlay.connect();
		let oldSend = overlay.websocket.send;
		overlay.websocket.send = function (to) {
			if (to !== localid2.id) {
				oldSend.apply(this, arguments);
			} else {
				console.log('bam! ' + to);
			}
			//overlay.oldSend(envelope);
		};
		return overlay;
	}
}, (server) => server.setProbationTimeout(2));

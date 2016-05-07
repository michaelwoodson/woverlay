"use strict"

let intTest = require('./lib/int.test');
let waitFor = require('./lib/wait.for');

const PORT = 5001;

intTest(__filename, PORT, () => {
	let test = require('tape');

	let LocalID = require('../lib/localid').LocalID;
	let Overlay = require('../lib/overlay').Overlay;

	test('subordinate connections', function(t) {
		let localid = new LocalID(true);
		let overlay1 = makeOverlay(localid);
		let overlay2 = makeOverlay(new LocalID(false, localid));
		waitFor(()=>!overlay1.status.subordinateMode && overlay2.status.subordinateMode)
		.then(() => {
			t.pass('overlay 2 became subordinate');
			var overlay3 = makeOverlay(new LocalID(false, localid));
			return waitFor(() => !overlay1.status.subordinateMode && overlay3.status.subordinateMode);
		}).then(() => {
			t.pass('overlay 3 became subordinate');
			var differentIdOverlay = makeOverlay(new LocalID(true));
			return waitFor(() => differentIdOverlay.status.initialized);
		}).then(() => { 
			t.pass('made overlay connection with different id')
			overlay1.websocket.disconnect();
			var overlay4 = makeOverlay(new LocalID(false, localid));
			return waitFor(() => !overlay1.status.subordinateMode && overlay4.status.subordinateMode);
		}).then(() => {
			t.pass('overlay 4 became subordinate');
			t.end();
		}).catch(() => {
			t.fail('failed making subordinates');
			t.end()
		});
	});

	function makeOverlay(localid) {
		let overlay = new Overlay(localid, 'ws://localhost:' + PORT + '/');
		overlay.connect();
		return overlay;
	}
})

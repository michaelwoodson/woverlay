'use strict';

let intTest = require('./lib/int.test');
let waitFor = require('./lib/wait.for');

const PORT = 5005;
intTest(__filename, PORT, () => {
	let test = require('tape');

	let idJsonArray = require('./lib/test.localids.25');
	let LocalID = require('../lib/localid').LocalID;
	let Overlay = require('../lib/overlay').Overlay;

	let overlays = [];
	let overlayMap = new Map();
	idJsonArray.forEach((idJson) => {
		let localid = new LocalID(false, null, idJson);
		let overlay = makeOverlay(localid);
		overlays.push(overlay);
		overlayMap.set(localid.id.substring(0, 5), overlay);
	});

	test('dht', function(t) {
		const WAIT_TIME = 60;
		let o60e53 = overlayMap.get('60e53');
		waitFor(()=>{
			//let pendingCount = overlays.map(o => o.pendingEnvelopes.length).reduce((a,b) => a+b);
			//let floodCount = overlays.map(o => o.flood.length).reduce((a,b) => a+b);
			//console.log(`pendingCount: ${pendingCount}, averageFlood: ${floodCount/overlays.length}, overlay: ${idhelper.shortArray(o60e53.flood)} target: ${idhelper.shortArray(o60e53.targetFlood())}`);
			return o60e53.flood.length == 5;
		}, WAIT_TIME)
		.then(() => {
			t.pass('full flood');
			return waitFor(() => o60e53.flood[0].indexOf('5c987') == 0, WAIT_TIME);
		}).then(() => {
			t.pass('got peer on left');
			return waitFor(() => o60e53.flood[4].indexOf('7268d') == 0, WAIT_TIME);
		}).then(() => { 
			t.pass('got peer on right');
			return waitFor(() => overlays.map(o => o.flood.length).reduce((a,b)=>a+b) == overlays.length * 5, WAIT_TIME);
		}).then(() => { 
			t.pass('all floods created');
			return waitFor(() => o60e53.fingers.length === 3);
		}).then(() => { 
			// Note: sha256('foo') -> 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
			t.pass('all fingers created');
			return o60e53.put('foo', 'bar');
		}).then(() => {
			t.pass('put value into dht');
			return o60e53.get('foo');
		}).then((result) => {
			t.ok(result[o60e53.localid.id] == 'bar', 'got value from dht');
			t.end();
		}).catch((e) => {
			console.log('failed: ' + e);
			t.fail('failed waiting for dht');
			t.end();
		});
	});

	function makeOverlay(localid) {
		let overlay = new Overlay(localid, 'ws://localhost:' + PORT + '/');
		overlay.connect();
		return overlay;
	}
});

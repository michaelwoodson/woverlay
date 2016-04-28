"use strict"

let test = require('tape');
let LocalID = require('../lib/localid').LocalID;
let Overlay = require('../lib/overlay').Overlay;

const PORT = 5001;
const SECONDS_TO_WAIT = 10;

let overlays = [];
let handle = null;

for (let i = 0; i < 5; i++) {
	overlays.push(makeOverlay());
}

test('overlay network', function(t) {
	let counter = 0;
	t.plan(1);
	handle = setInterval(() => {
		if (overlays[0].flood.length == 5) {
			t.pass('completed flood network');
		} else if (counter++ >= SECONDS_TO_WAIT) {
			t.fail('flood did not complete, seconds waited: ' + SECONDS_TO_WAIT);
		} else {
			console.log('waiting, flood size: ' + overlays[0].flood.length);
		}
	}, 1000);
});

function makeOverlay() {
	let overlay = new Overlay(new LocalID(true), 'ws://localhost:' + PORT + '/');
	overlay.connect();
	return overlay;
}
